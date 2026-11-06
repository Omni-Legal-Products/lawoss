import { describe, expect, test } from "bun:test";
import { serverSentEvents } from "@legalwork/types/sync-events";

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
