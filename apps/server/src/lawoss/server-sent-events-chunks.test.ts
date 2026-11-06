import { describe, expect, test } from "bun:test";
import { maxEventBytes, serverSentEvents } from "@legalwork/types/sync-events";

function collect() {
  const got: string[] = [];
  return { got, feed: serverSentEvents((data) => got.push(data)) };
}

function feedInChunks(stream: string, size: number) {
  const { got, feed } = collect();
  for (let i = 0; i < stream.length; i += size) feed(stream.slice(i, i + size));
  return got;
}

const frames = ['data: {"a":1}\ndata: {"b":2}\n\n', "event: x\ndata: second\n\n", "data: ok\n\n"].join("");

describe("serverSentEvents v rozdrobenom streame", () => {
  for (const [name, eol] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ] as const) {
    test(`${name}: kúsky po 1 znaku dajú rovnaké udalosti ako celý stream`, () => {
      const stream = frames.replace(/\n/g, eol);
      const whole = feedInChunks(stream, stream.length);
      expect(whole).toEqual(['{"a":1}\n{"b":2}', "second", "ok"]);
      for (const size of [1, 2, 3, 5, 7]) expect(feedInChunks(stream, size)).toEqual(whole);
    });
  }

  test("\\r\\n medzi dvoma kúskami nevytvorí falošnú hranicu udalosti", () => {
    const { got, feed } = collect();
    feed('data: {"a":1}\r');
    feed('\ndata: {"b":2}\r\n\r\n');
    expect(got).toEqual(['{"a":1}\n{"b":2}']);
  });

  test("\\r\\n\\r\\n rozdelené na hranici kúskov dá jednu hranicu bez prázdnej udalosti", () => {
    const stream = "data: one\r\n\r\ndata: two\r\n\r\n";
    for (let cut = 1; cut < stream.length; cut++) {
      const { got, feed } = collect();
      feed(stream.slice(0, cut));
      feed(stream.slice(cut));
      expect(got).toEqual(["one", "two"]);
    }
    for (const parts of [
      ["data: x\r", "\n\r\n"],
      ["data: x\r\n", "\r\n"],
      ["data: x\r\n\r", "\n"],
      ["data: x\r", "\n", "\r", "\n"],
    ]) {
      const { got, feed } = collect();
      for (const part of parts) feed(part);
      expect(got).toEqual(["x"]);
    }
  });

  test("koncové \\r\\r hneď ukončí udalosť", () => {
    const { got, feed } = collect();
    feed("data: x\r\r");
    expect(got).toEqual(["x"]);
  });

  test("neúplný rámec sa nevydá, kým nepríde hranica", () => {
    const { got, feed } = collect();
    feed("data: x\n");
    feed("data: y");
    expect(got).toEqual([]);
    feed("\n\n");
    expect(got).toEqual(["x\ny"]);
  });

  test("rámec 200 000 B po 1 znaku prejde v lineárnom čase", () => {
    const body = "a".repeat(200_000 - "data: \n\n".length);
    const started = performance.now();
    const got = feedInChunks(`data: ${body}\n\n`, 1);
    const elapsed = performance.now() - started;
    expect(got).toEqual([body]);
    // Starý kód: kvadratický (sekundy). Lineárny: desiatky ms. Hranica je veľkorysá, nie krehká.
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe("serverSentEvents: nedokončená udalosť má hranicu", () => {
  const limit = 64;
  /** Rámec s presne touto dĺžkou, bez hranice. */
  const frameOf = (length: number) => `data: ${"x".repeat(length - "data: ".length)}`;
  const body = (length: number) => "x".repeat(length - "data: ".length);

  function run(pieces: string[], max = limit) {
    const got: string[] = [];
    const feed = serverSentEvents((data) => got.push(data), max);
    for (const piece of pieces) feed(piece);
    return got;
  }
  function chunks(stream: string, size: number) {
    const pieces: string[] = [];
    for (let i = 0; i < stream.length; i += size) pieces.push(stream.slice(i, i + size));
    return pieces;
  }

  for (const [name, eol] of [["LF", "\n"], ["CRLF", "\r\n"], ["CR", "\r"]] as const) {
    test(`${name}: pridlhá udalosť sa zahodí a nasledujúca príde, nech je stream rozdelený akokoľvek`, () => {
      const stream = `data: a${eol}${eol}${frameOf(limit + 1)}${eol}${eol}data: b${eol}${eol}`;
      const expected = ["a", "b"];
      expect(run([stream])).toEqual(expected);
      for (const size of [1, 2, 3, 5, 7, 11, limit, limit + 1]) expect(run(chunks(stream, size))).toEqual(expected);
      for (let cut = 1; cut < stream.length; cut++) expect(run([stream.slice(0, cut), stream.slice(cut)])).toEqual(expected);
    });
  }

  test("udalosť presne na hranici sa doručí, o znak dlhšia nie, pri každom delení", () => {
    const exact = `${frameOf(limit)}\n\n`;
    const over = `${frameOf(limit + 1)}\n\n`;
    for (let cut = 1; cut < exact.length; cut++) expect(run([exact.slice(0, cut), exact.slice(cut)])).toEqual([body(limit)]);
    for (let cut = 1; cut < over.length; cut++) expect(run([over.slice(0, cut), over.slice(cut)])).toEqual([]);
    for (const size of [1, 2, 3]) {
      expect(run(chunks(exact, size))).toEqual([body(limit)]);
      expect(run(chunks(over, size))).toEqual([]);
    }
  });

  test("hranica rozdelená medzi kúsky aj udalosti v tom istom kúsku za ňou prejdú", () => {
    const big = frameOf(limit * 2);
    expect(run([big, "\n", "\ndata: a\n\n"])).toEqual(["a"]);
    expect(run([big, "\n\ndata: a\n\ndata: b\n\n"])).toEqual(["a", "b"]);
    expect(run([big, "\r\n", "\r\ndata: a\r\n\r\n"])).toEqual(["a"]);
    // Zvyšok za hranicou ešte nie je celá udalosť: dokončí ju ďalší kúsok.
    expect(run([big, "\n\ndata: a", "b\n\n"])).toEqual(["ab"]);
    // Pridlhý zvyšok za poslednou hranicou v jednom kúsku.
    expect(run([`data: a\n\n${big}`, "ešte\n\n", "data: b\n\n"])).toEqual(["a", "b"]);
    // Pridlhá udalosť uprostred kúska.
    expect(run([`data: a\n\n${big}\n\ndata: b\n\n`])).toEqual(["a", "b"]);
  });

  test("predvolená hranica je 16 MiB", () => {
    expect(maxEventBytes).toBe(16 * 1024 * 1024);
    const withDefault = (pieces: string[]) => {
      const got: string[] = [];
      const feed = serverSentEvents((data) => got.push(data));
      for (const piece of pieces) feed(piece);
      return got;
    };
    const megabyte = "x".repeat(1024 * 1024);
    expect(withDefault(["data: ", ...Array.from({ length: 17 }, () => megabyte), "\n\ndata: po nej\n\n"])).toEqual(["po nej"]);
    const exact = "x".repeat(maxEventBytes - "data: ".length);
    const delivered = withDefault([`data: ${exact}`, "\n\n"]);
    expect(delivered.length).toBe(1);
    expect(delivered[0] === exact).toBe(true);
    // O znak dlhšia v jednom kúsku: rovnako ako po častiach.
    expect(withDefault([`data: ${exact}x\n\ndata: po nej\n\n`])).toEqual(["po nej"]);
  });

  test("po zahodení drží len stav, nie obsah: ďalšie kúsky nepribúdajú do pamäte", () => {
    const got: string[] = [];
    const feed = serverSentEvents((data) => got.push(data), limit);
    feed(frameOf(limit + 1));
    for (let i = 0; i < 100_000; i++) feed("nikdy nekončiaci obsah ");
    feed("\n\ndata: ok\n\n");
    expect(got).toEqual(["ok"]);
  });
});

describe("serverSentEvents: drobné kúsky sa zlučujú", () => {
  test("cez hranicu zlučovania ostane obsah presný, aj s viacbajtovými znakmi a hranicou", () => {
    for (const count of [255, 256, 257, 258, 512, 513, 1_024, 65_793]) {
      const text = Array.from({ length: count }, (_, i) => "aá€😀"[i % 4] ?? "a").join("");
      const stream = `data: ${text}\n\ndata: ďalšia\n\n`;
      const got: string[] = [];
      const feed = serverSentEvents((data) => got.push(data));
      for (const char of stream) feed(char);
      expect(got.length).toBe(2);
      expect(got[0] === text).toBe(true);
      expect(got[1]).toBe("ďalšia");
    }
  });

  test("milióny jednoznakových kúskov nezaberú pamäť za každý zvlášť", () => {
    const count = 4_000_000;
    const feed = serverSentEvents(() => undefined);
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    feed("data: ");
    for (let i = 0; i < count; i++) feed("x");
    Bun.gc(true);
    const perChar = (process.memoryUsage().heapUsed - before) / count;
    // Zoznam kúskov stojí aspoň 8 B na znak (ukazovateľ v poli), spojený reťazec okolo 1 B.
    expect(perChar).toBeLessThan(4);
    feed("\n\n");
  });

  test("zlučovanie je lineárne: takmer celá hranica po jednom znaku", () => {
    const size = maxEventBytes - 1024;
    const got: string[] = [];
    const feed = serverSentEvents((data) => got.push(data));
    const started = performance.now();
    feed("data: ");
    for (let i = 0; i < size; i++) feed("x");
    feed("\n\n");
    const elapsed = performance.now() - started;
    expect(got[0]?.length).toBe(size);
    // Lineárne: stovky ms. Spájanie celého zoznamu pri každom zlúčení je kvadratické (viac ako 10 s).
    expect(elapsed).toBeLessThan(5_000);
  }, 60_000);
});
