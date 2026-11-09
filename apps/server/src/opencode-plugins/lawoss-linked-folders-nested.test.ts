// LAWOSS #264 (rozhodnutie MČ 23. 10. a 31. 10. 2026): natívne nástroje enginu v chate nadradeného klienta do priečinka
// vnoreného iného klienta. Engine sa na cestu v priečinku chatu `external_directory` nepýta; plugin `lawoss-linked-folders`
// preto v háčiku `permission.evaluate` zdvihne `read`, `edit`, `glob`, `grep` a príkaz s cestou na kartu s varovaním,
// aj nad `allow` a aj v YOLO. Vlastné súbory klienta a jeho spisy (vnorený bez karty) kartu nedostanú. Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LINKED_FOLDERS_MAP_FILE, NESTED_CLIENT_CARD_PREFIX, type LinkedFoldersMap } from "../lawoss/linked-folders-rules.js";
import LinkedFolders from "./lawoss-linked-folders.js";
import { lawossNativePlugin } from "./lawoss-native-test-support.js";

const previous = process.env.OPENCODE_CONFIG;
const roots: string[] = [];
afterEach(async () => {
  if (previous === undefined) delete process.env.OPENCODE_CONFIG; else process.env.OPENCODE_CONFIG = previous;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

type Effect = "allow" | "ask" | "deny";
type Cards = "both" | "parent" | "nested" | "none";

/** Nadradený klient P s vnoreným registrovaným priečinkom N; karty podľa `cards`. Mapa ako ju zapíše server. */
async function fixture(cards: Cards, yolo = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-nested-tools-")));
  roots.push(root);
  const parent = join(root, "prax", "Klienti", "Tatran"), nested = join(parent, "Dcéra s.r.o."), matter = join(parent, "Spisy", "Úhrada");
  const runtime = join(root, "runtime");
  for (const folder of [join(nested, "Zmluvy"), matter, runtime]) await mkdir(folder, { recursive: true });
  await writeFile(join(nested, "Zmluvy", "zmluva.txt"), "syntetický obsah");
  const parentCard = cards === "both" || cards === "parent" ? parent : null;
  const nestedCard = cards === "both" || cards === "nested" ? nested : parentCard;
  const map: LinkedFoldersMap = { version: 1, officeRoot: join(root, "prax"), firmManaged: false,
    clients: [{ root: parent, folders: [], client: parentCard }, { root: nested, folders: [], client: nestedCard }], ...(yolo ? { yolo: true } : {}) };
  await writeFile(join(runtime, LINKED_FOLDERS_MAP_FILE), JSON.stringify(map));
  process.env.OPENCODE_CONFIG = join(runtime, "runtime-opencode-config.json");
  return { parent, nested, matter };
}

async function evaluate(directory: string, action: string, resources: string[], options: { effect?: Effect; metadata?: Record<string, unknown>; sessionID?: string; plugin?: Awaited<ReturnType<typeof lawossNativePlugin>> } = {}) {
  const plugin = options.plugin ?? await lawossNativePlugin(LinkedFolders, { directory });
  plugin.runtime.move(directory);
  const event = { sessionID: options.sessionID ?? "ses_1", agent: "legalwork", action, resources, effect: options.effect ?? "allow" as Effect, message: undefined as string | undefined,
    ...(options.metadata ? { metadata: options.metadata } : {}) };
  await plugin.runtime.hook("permission", "evaluate", event);
  return { effect: event.effect, message: event.message, plugin };
}

for (const cards of ["both", "none", "nested"] as const) {
  test(`chat nadradeného → vnorený iný klient (karty: ${cards}): read, edit, glob, grep a príkaz s cestou dostanú kartu, aj v YOLO`, async () => {
    for (const yolo of [false, true]) {
      const { parent, nested } = await fixture(cards, yolo);
      const card = `${NESTED_CLIENT_CARD_PREFIX}${nested}`;
      const cases: [string, string[], Record<string, unknown>?][] = [
        ["read", ["Dcéra s.r.o./Zmluvy/zmluva.txt"]],
        ["read", [join(nested, "Zmluvy", "zmluva.txt")]],
        ["read", ["Dcéra s.r.o."]],
        ["edit", ["Dcéra s.r.o./nový.txt"]],
        ["glob", ["*.txt"], { root: "Dcéra s.r.o.", path: "Dcéra s.r.o." }],
        ["glob", ["**/*.txt"], { root: "." }],
        ["grep", ["zmluva"], { root: "." }],
        ["grep", ["zmluva"], { root: ".", path: "Dcéra s.r.o./Zmluvy" }],
        ["shell", [`cat "${join(nested, "Zmluvy", "zmluva.txt")}"`]],
        ["shell", [`ls "Dcéra s.r.o./Zmluvy"`]],
      ];
      for (const [action, resources, metadata] of cases) {
        const result = await evaluate(parent, action, resources, { metadata });
        expect({ action, resources, ...result, plugin: undefined }).toEqual({ action, resources, effect: "ask", message: card, plugin: undefined });
      }
    }
  });
}

test("vlastné súbory nadradeného klienta a jeho spis (vnorený bez karty) kartu nedostanú; zákaz ostáva zákazom", async () => {
  const { parent, nested } = await fixture("both");
  for (const [action, resources, metadata] of [
    ["read", ["Spisy/Úhrada/podanie.txt"]],
    ["edit", ["poznámky.md"]],
    ["glob", ["*.txt"], { root: "." }],
    ["glob", ["Spisy/**"], { root: "." }],
    ["grep", ["zmluva"], { root: ".", path: "Spisy" }],
    ["shell", ["ls Spisy"]],
  ] as [string, string[], Record<string, unknown>?][]) {
    expect((await evaluate(parent, action, resources, { metadata })).effect).toBe("allow");
  }
  expect((await evaluate(parent, "read", ["Dcéra s.r.o./Zmluvy/zmluva.txt"], { effect: "deny" })).effect).toBe("deny");
  // Chat vnoreného klienta v jeho vlastnom priečinku: bez karty.
  expect((await evaluate(nested, "read", ["Zmluvy/zmluva.txt"])).effect).toBe("allow");
  // Prípad b: vnorený bez karty pod kartou nadradeného je ten istý klient (spis).
  const same = await fixture("parent");
  for (const [action, resources] of [["read", ["Dcéra s.r.o./Zmluvy/zmluva.txt"]], ["grep", ["zmluva"]], ["shell", [`cat "Dcéra s.r.o./Zmluvy/zmluva.txt"`]]] as const)
    expect((await evaluate(same.parent, action, [...resources], { metadata: { root: "." } })).effect).toBe("allow");
});

test("external_directory do vnoreného iného klienta: karta aj v YOLO, aj bez karty klientov a aj nad `allow`; spis bez karty ostane povolený", async () => {
  for (const cards of ["both", "none"] as const) {
    const { matter, nested, parent } = await fixture(cards, true);
    const card = `${NESTED_CLIENT_CARD_PREFIX}${nested}`;
    for (const effect of ["ask", "allow"] as const) {
      // Chat spisu nadradeného klienta: priečinok vnoreného je mimo chatu (engine sa pýta `external_directory`).
      expect(await evaluate(matter, "external_directory", [`${join(nested, "Zmluvy")}/*`], { effect }).then(({ effect, message }) => ({ effect, message }))).toEqual({ effect: "ask", message: card });
    }
    // Opačne: chat vnoreného klienta do priečinka nadradeného (iný klient) tiež kartu.
    const reverse = await evaluate(nested, "external_directory", [`${join(parent, "Spisy")}/*`], { effect: "ask" });
    expect(reverse).toMatchObject({ effect: "ask", message: `${NESTED_CLIENT_CARD_PREFIX}${parent}` });
  }
  const same = await fixture("parent", true);
  // Spis bez karty: z chatu spisu do vnoreného spisu ide YOLO bez karty ako doteraz.
  expect((await evaluate(same.matter, "external_directory", [`${same.nested}/*`], { effect: "ask" })).effect).toBe("allow");
});

test("zamietnutá karta vnoreného klienta sa v tom istom chate znova neukáže", async () => {
  const { parent, nested } = await fixture("both");
  const first = await evaluate(parent, "read", ["Dcéra s.r.o./Zmluvy/zmluva.txt"]);
  expect(first.effect).toBe("ask");
  await first.plugin.runtime.event({ type: "permission.asked", data: { id: "per_1", sessionID: "ses_1", action: "read", resources: ["Dcéra s.r.o./Zmluvy/zmluva.txt"] } });
  await first.plugin.runtime.event({ type: "permission.replied", data: { sessionID: "ses_1", requestID: "per_1", reply: "reject" } });
  const again = await evaluate(parent, "grep", ["zmluva"], { metadata: { root: ".", path: "Dcéra s.r.o." }, plugin: first.plugin });
  expect(again.effect).toBe("deny");
  expect(again.message).toContain("already refused access to this folder");
  // Iný chat sa pýta znova.
  expect((await evaluate(parent, "read", [join(nested, "Zmluvy", "zmluva.txt")], { plugin: first.plugin, sessionID: "ses_2" })).effect).toBe("ask");
});

test("firma spravuje priečinky mimo projektu: karta vnoreného iného klienta platí ďalej", async () => {
  const { parent, nested } = await fixture("both");
  const map = JSON.parse(await Bun.file(join(dirname(process.env.OPENCODE_CONFIG!), LINKED_FOLDERS_MAP_FILE)).text());
  await writeFile(join(dirname(process.env.OPENCODE_CONFIG!), LINKED_FOLDERS_MAP_FILE), JSON.stringify({ ...map, firmManaged: true }));
  expect(await evaluate(parent, "read", ["Dcéra s.r.o./Zmluvy/zmluva.txt"]).then(({ effect, message }) => ({ effect, message }))).toEqual({ effect: "ask", message: `${NESTED_CLIENT_CARD_PREFIX}${nested}` });
  expect((await evaluate(parent, "read", ["poznámky.md"])).effect).toBe("allow");
});
