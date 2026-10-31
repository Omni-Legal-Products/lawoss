// LAWOSS alfa2 A3 (N-18): agent pozná pripojené priečinky svojho klienta z pripomienky v konverzácii (nie zo
// systémového promptu). Chat klienta aj chat prípadu ich dostanú; chat iného klienta nie (ani mená).
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  const writeMap = (aFolders: string[]) => writeFile(join(runtime, LINKED_FOLDERS_MAP_FILE), JSON.stringify({
    version: 1, officeRoot: join(root, "prax"), firmManaged: false, clients: [{ root: clientA, folders: aFolders, client: clientA }, { root: clientB, folders: [linkedB], client: clientB }],
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

// N-A7-14 (test E2): chat klienta C001 žiada priečinok klienta C002 tej istej praxe. Plugin odmietne s vetou pre agenta
// (bez cesty a mena), advokát kartu nedostane. Pripojený priečinok mimo praxe (E1) ostane povolený bez karty.
test("priečinok iného klienta: odmietnutie s vetou; vlastný pripojený priečinok „once“; neznámy priečinok bez odpovede", async () => {
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

  // Vzor z testu E2 (`…/Klienti/C002*/*`) aj súbor klienta B, aj z chatu prípadu.
  for (const [directory, pattern] of [[clientA, `${join(clientB, "..")}/Hr*/*`], [matterA, `${clientB}/*`]] as const) {
    const { v1, v2 } = await ask(directory, [pattern]);
    expect(v1).toEqual([]);
    expect(v2).toHaveLength(1);
    const request = v2[0] as { url: string; path: { requestID: string }; body: { reply: string; message: string }; query: { directory: string } };
    expect(request.url).toBe("/permission/{requestID}/reply");
    expect(request.path.requestID).toBe("per_1");
    expect(request.body.reply).toBe("reject");
    expect(request.body.message).toContain("belongs to another client");
    expect(request.body.message).not.toContain("Hron");
    expect(request.query.directory).toBe(directory);
  }
  // Engine bez trasy s vetou: holé odmietnutie ako „Zamietnuť“ na karte.
  for (const options of [{ raw: false }, { rawFails: true }]) {
    const { v1 } = await ask(clientA, [`${clientB}/*`], options);
    expect(v1).toEqual([{ path: { id: "ses_1", permissionID: "per_1" }, body: { response: "reject" }, query: { directory: clientA } }]);
  }
  // E1: pripojený priečinok mimo praxe ostane „once“; nepripojený priečinok mimo klientov zostane na karte.
  const linked = await ask(clientA, [`${linkedA}/*`]);
  expect(linked.v2).toEqual([]);
  expect(linked.v1).toEqual([{ path: { id: "ses_1", permissionID: "per_1" }, body: { response: "once" }, query: { directory: clientA } }]);
  const unknown = await ask(clientA, [`${join(clientA, "..", "..", "..")}/Iny/*`]);
  expect([...unknown.v1, ...unknown.v2]).toEqual([]);
  // Neistý vzor: bez odpovede, rozhodne karta (review #295).
  const open = await ask(clientA, [`${join(clientB, "..")}/{Hron,Iny}/*`]);
  expect([...open.v1, ...open.v2]).toEqual([]);
});

// Rozhodnutie MČ 30. 10. 2026 (N-A7-14, N-A8-2): priečinok klientov (`…/Klienti`) a vzor cez všetkých klientov sa odmietnu
// bez karty a bez mien; veta zakáže radiť povolenie. Rozsah zamietnutý na karte sa v tom istom rozhovore neukáže znova.
type Sent = { body: { reply: string; message: string } };
async function plugin(directory: string, sessions: Record<string, { parentID?: string }> = {}) {
  const v1: unknown[] = [], v2: Sent[] = [];
  const hooks = await LawossLinkedFolders({ directory, client: {
    postSessionIdPermissionsPermissionId: async (request: unknown) => { v1.push(request); return {}; },
    _client: { post: async (request: unknown) => { v2.push(request as Sent); return { response: { ok: true } }; } },
    session: { get: async ({ path }: { path: { id: string } }) => ({ data: { directory, ...sessions[path.id] } }), messages: async () => ({ data: [] }) },
  } });
  const ask = (id: string, sessionID: string, patterns: string[]) => hooks.event({ event: { type: "permission.asked", properties: { id, sessionID, permission: "external_directory", patterns } } });
  const reply = (id: string, sessionID: string, answer: string) => hooks.event({ event: { type: "permission.replied", properties: { sessionID, requestID: id, reply: answer } } });
  return { v1, v2, ask, reply, hooks };
}

test("priečinok klientov a vzor cez všetkých klientov: odmietnutie bez karty, bez mien a bez rady povoliť", async () => {
  const { clientA, matterA, clientB } = await fixture();
  const klienti = join(clientB, "..");
  for (const [directory, pattern] of [[clientA, `${klienti}/*`], [clientA, `${klienti}/*/*`], [matterA, `${join(klienti, "..")}/*`], [clientA, `${klienti}/H*/*`]] as const) {
    const { v1, v2, ask } = await plugin(directory);
    await ask("per_1", "ses_1", [pattern]);
    expect(v1).toEqual([]);
    expect(v2).toHaveLength(1);
    const { reply, message } = v2[0]!.body;
    expect(reply).toBe("reject");
    for (const name of ["Hron", "Tatran", "Klienti", "prax"]) expect(message).not.toContain(name);
    expect(message).toContain("Never advise the user to allow, authorize or link");
    expect(message).not.toMatch(/Settings|Permissions|AI Providers/);
    expect(message).toContain(pattern.endsWith("/H*/*") ? "belongs to another client" : "contains folders of other clients");
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
