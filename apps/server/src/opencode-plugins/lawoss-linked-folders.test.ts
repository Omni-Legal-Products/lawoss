// LAWOSS alfa2 A3 (N-18): agent pozná pripojené priečinky svojho klienta z pripomienky v konverzácii (nie zo
// systémového promptu). Chat klienta aj chat prípadu ich dostanú; chat iného klienta nie (ani mená).
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { LINKED_FOLDERS_MAP_FILE, type LinkedFoldersMap } from "../lawoss/linked-folders-rules.js";
import { LawossLinkedFolders } from "./lawoss-linked-folders.js";

const previous = process.env.OPENCODE_CONFIG;
const roots: string[] = [];
afterEach(async () => {
  if (previous === undefined) delete process.env.OPENCODE_CONFIG; else process.env.OPENCODE_CONFIG = previous;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-reminder-")));
  roots.push(root);
  const clientA = join(root, "prax", "Klienti", "Tatran"), matterA = join(clientA, "Spisy", "M001 Úhrada"), clientB = join(root, "prax", "Klienti", "Hron");
  const linkedA = join(root, "pripojeny-A"), linkedB = join(root, "Hron podklady"), runtime = join(root, "runtime");
  for (const folder of [matterA, clientB, linkedA, linkedB, runtime]) await mkdir(folder, { recursive: true });
  const writeMap = (aFolders: string[], yolo = false) => writeFile(join(runtime, LINKED_FOLDERS_MAP_FILE), JSON.stringify({
    version: 1, officeRoot: join(root, "prax"), firmManaged: false, clients: [{ root: clientA, folders: aFolders, client: clientA }, { root: clientB, folders: [linkedB], client: clientB }],
    ...(yolo ? { yolo: true } : {}),
  } satisfies LinkedFoldersMap));
  await writeMap([linkedA]);
  process.env.OPENCODE_CONFIG = join(runtime, "runtime-opencode-config.json");
  return { clientA, matterA, clientB, linkedA, linkedB, writeMap };
}

async function chat(directory: string) {
  const hooks = await LawossLinkedFolders({ directory, client: { session: { messages: async () => ({ data: [] }) } } });
  const send = async (sessionID: string) => {
    const output: { message: { id: string }; parts: object[] } = { message: { id: "msg_1" }, parts: [] };
    await hooks["chat.message"]({ sessionID }, output);
    return output.parts.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join("\n");
  };
  const system = async () => {
    const output: string[] = [];
    await hooks["experimental.chat.system.transform"]({}, { system: output });
    return output.join("\n");
  };
  return { send, system };
}

test("chat klienta aj chat prípadu dostanú pripojené priečinky klienta; chat iného klienta nie", async () => {
  const { clientA, matterA, clientB, linkedA, linkedB } = await fixture();
  const a = await (await chat(clientA)).send("ses_a");
  expect(a).toContain('<system-reminder topic="linked-folders">');
  expect(a).toContain(`- pripojeny-A: ${linkedA}`);
  expect(a).toContain("lawoss_documents_prepare");
  // N-A7-5: glob bez cesty hľadá len v koreni klienta; pripomienka hovorí, ako hľadať v pripojenom priečinku.
  expect(a).toContain("glob without a path searches only this chat's folder");
  expect(a).not.toContain("covers only the client's own folder");
  expect(a).toContain("run glob with that folder's absolute path as path");
  expect(a).toContain("takes file paths only, never a folder");
  expect(a).not.toContain(clientA);
  expect(a).not.toContain(linkedB);
  const matter = await (await chat(matterA)).send("ses_m");
  expect(matter).toContain(`- pripojeny-A: ${linkedA}`);
  // V chate prípadu glob bez cesty hľadá len v prípade, nie v celom klientovi.
  expect(matter).toContain("glob without a path searches only this chat's folder");
  const b = await (await chat(clientB)).send("ses_b");
  expect(b).toContain(`- Hron podklady: ${linkedB}`);
  expect(b).not.toContain(linkedA);
  expect(b).not.toContain("Tatran");
});

test("pripomienka len pri zmene; po odpojení raz „už nie sú“; bez priečinkov žiadna", async () => {
  const { clientA, writeMap } = await fixture();
  const session = await chat(clientA);
  expect(await session.send("ses_1")).toContain("pripojeny-A");
  expect(await session.send("ses_1")).toBe("");
  await writeMap([]);
  expect(await session.send("ses_1")).toContain("no linked folders any more");
  expect(await session.send("ses_1")).toBe("");
  expect(await (await chat(clientA)).send("ses_2")).toBe("");
});

test("systémový text je pevný: nemení sa so zoznamom pripojených priečinkov ani medzi klientmi a prípadmi", async () => {
  const { clientA, matterA, clientB, linkedA, writeMap } = await fixture();
  const a = await chat(clientA);
  const texts = [await a.system()];
  await writeMap([]);
  texts.push(await a.system());
  await writeMap([linkedA, join(linkedA, "..", "iný")]);
  texts.push(await a.system(), await (await chat(matterA)).system(), await (await chat(clientB)).system());
  // Zmena zoznamu sa medzitým v pripomienke prejaví (kontrola, že mapa sa naozaj zmenila).
  expect(await a.send("ses_s")).toContain("- iný:");
  expect(new Set(texts).size).toBe(1);
  expect(texts[0]).toContain("linked-folders reminder");
  expect(texts[0]).not.toContain("pripojeny-A");
});

// N-A7-14 (test E2), rozhodnutie MČ 31. 10. 2026: chat klienta C001 žiada priečinok klienta C002 tej istej praxe. Plugin
// neodpovie: advokát dostane kartu (appka na nej varuje). Pripojený priečinok mimo praxe (E1) ostane povolený bez karty.
test("priečinok iného klienta: karta (bez odpovede pluginu); vlastný pripojený priečinok „once“; neznámy priečinok bez odpovede", async () => {
  const { clientA, matterA, clientB, linkedA } = await fixture();
  const ask = async (directory: string, patterns: string[], options: { raw?: boolean; rawFails?: boolean } = {}) => {
    const v1: unknown[] = [], v2: unknown[] = [];
    const raw = options.raw === false ? undefined : { post: async (request: unknown) => { v2.push(request); return options.rawFails ? { error: { name: "NotFound" }, response: { ok: false } } : { data: true, response: { ok: true } }; } };
    const hooks = await LawossLinkedFolders({ directory, client: {
      postSessionIdPermissionsPermissionId: async (request: unknown) => { v1.push(request); return {}; },
      _client: raw,
      session: { get: async () => ({ data: { directory } }), messages: async () => ({ data: [] }) },
    } });
    await hooks.event({ event: { type: "permission.asked", properties: { id: "per_1", sessionID: "ses_1", permission: "external_directory", patterns } } });
    return { v1, v2 };
  };

  // Vzor z testu E2 (`…/Klienti/C002*/*`) aj priečinok klienta B, aj z chatu prípadu: karta, nič sa neodmietne.
  for (const [directory, pattern] of [[clientA, `${join(clientB, "..")}/Hr*/*`], [matterA, `${clientB}/*`], [matterA, `${clientB}/Spisy/*`]] as const) {
    const { v1, v2 } = await ask(directory, [pattern]);
    expect([...v1, ...v2]).toEqual([]);
  }
  // Nejednoznačný rozsah sa odmietne s vetou; engine bez trasy s vetou dostane holé odmietnutie ako „Zamietnuť“ na karte.
  const ambiguous = await ask(clientA, [`$PRAX/Klienti/Hron/*`]);
  expect(ambiguous.v1).toEqual([]);
  expect(ambiguous.v2).toHaveLength(1);
  const request = ambiguous.v2[0] as { url: string; path: { requestID: string }; body: { reply: string; message: string }; query: { directory: string } };
  expect(request.url).toBe("/permission/{requestID}/reply");
  expect(request.path.requestID).toBe("per_1");
  expect(request.body.reply).toBe("reject");
  expect(request.body.message).toContain("cannot be resolved to definite folders");
  expect(request.query.directory).toBe(clientA);
  for (const options of [{ raw: false }, { rawFails: true }]) {
    const { v1 } = await ask(clientA, [`$PRAX/Klienti/Hron/*`], options);
    expect(v1).toEqual([{ path: { id: "ses_1", permissionID: "per_1" }, body: { response: "reject" }, query: { directory: clientA } }]);
  }
  // E1: pripojený priečinok mimo praxe ostane „once“; nepripojený priečinok mimo klientov zostane na karte.
  const linked = await ask(clientA, [`${linkedA}/*`]);
  expect(linked.v2).toEqual([]);
  expect(linked.v1).toEqual([{ path: { id: "ses_1", permissionID: "per_1" }, body: { response: "once" }, query: { directory: clientA } }]);
  const unknown = await ask(clientA, [`${join(clientA, "..", "..", "..")}/Iny/*`]);
  expect([...unknown.v1, ...unknown.v2]).toEqual([]);
});

// Rozhodnutie MČ 31. 10. 2026: rozsah so znakmi `[ ] { } $ \`` sa normalizuje a vyhodnotí ako ostatné cesty (dovtedy karta).
test("rozsah so znakmi `[ ] { } $ \``: iný klient po normalizácii dostane kartu, nejednoznačný rozsah sa odmietne, vlastný klient ostane", async () => {
  const { clientA, clientB, matterA } = await fixture();
  const klienti = join(clientB, "..");
  const home = homedir();
  // Iný klient po normalizácii: karta (plugin neodpovie), aj v režime YOLO.
  const otherClient = [`${klienti}/H[a-z]on/*`, `${klienti}/{Hron,Iny}/*`, `${klienti}/{Tatran,Hron}/*`, `${klienti}/[HT]*/*`];
  // `$HOME` a `~` sa rozvinú na domov; mimo neho by iného klienta nenašli, preto sa skúšajú len v ňom.
  if (klienti.startsWith(`${home}/`)) otherClient.push(`$HOME${klienti.slice(home.length)}/Hron/*`, `~${klienti.slice(home.length)}/*`);
  for (const yolo of [false, true]) {
    for (const pattern of otherClient) {
      const { v1, v2, ask, hooks } = await plugin(clientA, {}, yolo);
      if (yolo) await hooks["chat.message"]({ sessionID: "ses_1" }, { message: { id: "msg_1", agent: "legalwork" }, parts: [] });
      await ask("per_1", "ses_1", [pattern]);
      expect([...v1, ...v2]).toEqual([]);
    }
  }
  // Čo sa normalizovať nedá: odmietnutie bez karty a bez mien.
  for (const pattern of [`${klienti}/\`ls\`/*`, `$PRAX/Klienti/Hron/*`, `${klienti}/{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}/*`]) {
    const { v1, v2, ask } = await plugin(clientA);
    await ask("per_1", "ses_1", [pattern]);
    expect(v1).toEqual([]);
    expect(v2).toHaveLength(1);
    expect(v2[0]!.body.reply).toBe("reject");
    expect(v2[0]!.body.message).toContain("cannot be resolved to definite folders");
    for (const name of ["Hron", "Tatran", "Klienti"]) expect(v2[0]!.body.message).not.toContain(name);
    expect(v2[0]!.body.message).toContain("Never advise the user to allow");
  }
  // Vlastný klient a jeho spisy so znakmi `[ ]` a `{ }`: povolené bez karty ako doteraz.
  for (const pattern of [`${clientA}/Spisy/M00[1]*/*`, `${clientA}/{Spisy,Zmluvy}/*`]) {
    for (const directory of [clientA, matterA]) {
      const { v1, v2, ask } = await plugin(directory);
      await ask("per_1", "ses_1", [pattern]);
      expect(v2).toEqual([]);
      expect(v1).toEqual([{ path: { id: "ses_1", permissionID: "per_1" }, body: { response: "once" }, query: { directory } }]);
    }
  }
});

// Rozhodnutie MČ 31. 10. 2026 (N-A7-14): priečinok klientov (`…/Klienti`) a vzor cez všetkých klientov dostanú kartu
// s varovaním (aj v YOLO). Rozsah zamietnutý na karte sa v tom istom rozhovore neukáže znova.
type Sent = { body: { reply: string; message: string } };
async function plugin(directory: string, sessions: Record<string, { parentID?: string }> = {}, yolo = false, saved: Record<string, unknown[]> = {}) {
  if (yolo) {
    const map = join(process.env.OPENCODE_CONFIG!, "..", LINKED_FOLDERS_MAP_FILE);
    await writeFile(map, JSON.stringify({ ...JSON.parse(await readFile(map, "utf8")), yolo: true }));
  }
  const v1: unknown[] = [], v2: Sent[] = [];
  const hooks = await LawossLinkedFolders({ directory, client: {
    postSessionIdPermissionsPermissionId: async (request: unknown) => { v1.push(request); return {}; },
    _client: { post: async (request: unknown) => { v2.push(request as Sent); return { response: { ok: true } }; } },
    session: { get: async ({ path }: { path: { id: string } }) => ({ data: { directory, ...sessions[path.id] } }),
      messages: async ({ path }: { path: { id: string } }) => ({ data: (saved[path.id] ?? []) as never[] }) },
  } });
  const ask = (id: string, sessionID: string, patterns: string[]) => hooks.event({ event: { type: "permission.asked", properties: { id, sessionID, permission: "external_directory", patterns } } });
  const reply = (id: string, sessionID: string, answer: string) => hooks.event({ event: { type: "permission.replied", properties: { sessionID, requestID: id, reply: answer } } });
  return { v1, v2, ask, reply, hooks };
}

test("priečinok klientov, nadradený priečinok a vzor cez všetkých klientov: karta, plugin nič neodmietne", async () => {
  const { clientA, matterA, clientB } = await fixture();
  const klienti = join(clientB, "..");
  for (const [directory, pattern] of [[clientA, `${klienti}/*`], [clientA, `${klienti}/*/*`], [matterA, `${join(klienti, "..")}/*`], [clientA, `${klienti}/H*/*`], [matterA, `${clientA}/*`]] as const) {
    const { v1, v2, ask } = await plugin(directory);
    await ask("per_1", "ses_1", [pattern]);
    // Chat prípadu a koreň vlastného klienta: „once“ ako doteraz; ostatné rozsahy siahajú na iného klienta: karta.
    if (pattern === `${clientA}/*`) expect(v1).toHaveLength(1);
    else expect([...v1, ...v2]).toEqual([]);
  }
});

test("rozsah zamietnutý na karte: ďalšia rovnaká žiadosť (aj z podagenta) bez karty; iný rozsah a iný chat kartu dostanú", async () => {
  const { clientA, clientB } = await fixture();
  const missing = join(clientB, "..", "Neexistuje");
  const { v1, v2, ask, reply } = await plugin(clientA, { ses_sub: { parentID: "ses_1" } });
  await ask("per_1", "ses_1", [`${missing}/*`]);
  expect([...v1, ...v2]).toEqual([]);
  await reply("per_1", "ses_1", "reject");
  for (const [id, session, pattern] of [["per_2", "ses_1", `${missing}/*`], ["per_3", "ses_1", `${missing}/Spisy/*`], ["per_4", "ses_sub", `${missing}/*`]] as const) {
    await ask(id, session, [pattern]);
    expect(v2.at(-1)?.body.reply).toBe("reject");
    expect(v2.at(-1)?.body.message).toContain("already refused access to this folder");
    expect(v2.at(-1)?.body.message).toContain("Never advise the user to allow");
  }
  expect(v2).toHaveLength(3);
  // Iný priečinok, iný chat a rozsah, ktorý advokát povolil: bežná karta.
  await ask("per_5", "ses_1", [`${join(missing, "..", "Iny")}/*`]);
  await ask("per_6", "ses_2", [`${missing}/*`]);
  await ask("per_7", "ses_1", [`${join(missing, "..", "Povoleny")}/*`]);
  await reply("per_7", "ses_1", "once");
  await ask("per_8", "ses_1", [`${join(missing, "..", "Povoleny")}/*`]);
  expect(v2).toHaveLength(3);
  expect(v1).toEqual([]);
  // Karta iného klienta zamietnutá: rovnaká žiadosť sa v tom istom rozhovore neukáže znova (bez rady povoliť).
  await ask("per_9", "ses_1", [`${clientB}/*`]);
  expect(v2).toHaveLength(3);
  await reply("per_9", "ses_1", "reject");
  await ask("per_10", "ses_1", [`${clientB}/Spisy/*`]);
  expect(v2).toHaveLength(4);
  expect(v2.at(-1)?.body.message).toContain("already refused access to this folder");
  expect(v2.at(-1)?.body.message).toContain("Never advise the user to allow");
  expect(v1).toEqual([]);
});

// Rozhodnutie MČ 31. 10. 2026: v režime YOLO engine chat agenta sa pýta aj naďalej, plugin povolí bez karty všetko okrem
// priečinka iného klienta (ten dostane kartu s varovaním). Podagent a chat bez YOLO majú karty ako doteraz.
test("YOLO: chat agent bez karty, karta len pri priečinku iného klienta; podagent a vypnutý YOLO ako doteraz", async () => {
  const { clientA, clientB, linkedA, writeMap } = await fixture();
  const klienti = join(clientB, "..");
  const outside = join(klienti, "..", "..", "Iny");
  const once = (id: string, session: string) => ({ path: { id: session, permissionID: id }, body: { response: "once" }, query: { directory: clientA } });
  const { v1, v2, ask, hooks } = await plugin(clientA, { ses_sub: { parentID: "ses_1" } }, true, { ses_saved: [{ info: { role: "user", agent: "legalwork" }, parts: [] }] });
  await hooks["chat.message"]({ sessionID: "ses_1" }, { message: { id: "msg_1", agent: "legalwork" }, parts: [] });
  await hooks["chat.message"]({ sessionID: "ses_sub" }, { message: { id: "msg_2", agent: "explore" }, parts: [] });
  // Obyčajný priečinok mimo chatu a pripojený priečinok: bez karty.
  await ask("per_1", "ses_1", [`${outside}/*`]);
  await ask("per_2", "ses_1", [`${linkedA}/*`]);
  // Chat agenta zistí plugin aj z uložených správ (napr. po reštarte enginu).
  await ask("per_3", "ses_saved", [`${outside}/*`]);
  expect(v1).toEqual([once("per_1", "ses_1"), once("per_2", "ses_1"), once("per_3", "ses_saved")]);
  // Priečinok iného klienta, priečinok klientov a nadradený priečinok: karta aj v YOLO.
  for (const pattern of [`${clientB}/*`, `${klienti}/*`, `${klienti}/*/*`, `${join(klienti, "..")}/*`]) await ask("per_4", "ses_1", [pattern]);
  // Podagent sa v YOLO pýta ako doteraz (YOLO platí len pre chat agenta), nejednoznačný rozsah sa odmietne.
  await ask("per_5", "ses_sub", [`${outside}/*`]);
  await ask("per_6", "ses_unknown", [`${outside}/*`]);
  expect(v1).toHaveLength(3);
  await ask("per_7", "ses_1", [`$PRAX/Klienti/Hron/*`]);
  expect(v2.map((sent) => sent.body.reply)).toEqual(["reject"]);
  // Bez YOLO: obyčajný priečinok mimo chatu dostane kartu.
  await writeMap([linkedA]);
  const off = await plugin(clientA);
  await off.hooks["chat.message"]({ sessionID: "ses_1" }, { message: { id: "msg_1", agent: "legalwork" }, parts: [] });
  await off.ask("per_1", "ses_1", [`${outside}/*`]);
  expect([...off.v1, ...off.v2]).toEqual([]);
});

test("systémový text: názvy nastavení po slovensky, bez anglických názvov a bez rady povoliť iného klienta", async () => {
  const { clientA } = await fixture();
  const { hooks } = await plugin(clientA);
  const output: string[] = [];
  await hooks["experimental.chat.system.transform"]({}, { system: output });
  const text = output.join("\n");
  expect(text).toContain("Nastavenia → Poskytovatelia AI");
  expect(text).toContain("Nastavenia → Oprávnenia nástrojov");
  expect(text).toContain("never LegalWork");
  expect(text).toContain("Never advise the user to allow, authorize or link a folder of another client");
  expect(text).not.toMatch(/Settings ?[>→]|AI Providers|Text recognition/);
});
