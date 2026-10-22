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
    version: 1, officeRoot: join(root, "prax"), firmManaged: false, clients: [{ root: clientA, folders: aFolders }, { root: clientB, folders: [linkedB] }],
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
  const system: string[] = [];
  await hooks["experimental.chat.system.transform"]({}, { system });
  return { send, system };
}

test("chat klienta aj chat prípadu dostanú pripojené priečinky klienta; chat iného klienta nie", async () => {
  const { clientA, matterA, clientB, linkedA, linkedB } = await fixture();
  const a = await (await chat(clientA)).send("ses_a");
  expect(a).toContain('<system-reminder topic="linked-folders">');
  expect(a).toContain(`- pripojeny-A: ${linkedA}`);
  expect(a).toContain("lawoss_documents_prepare");
  expect(a).not.toContain(clientA);
  expect(a).not.toContain(linkedB);
  const matter = await (await chat(matterA)).send("ses_m");
  expect(matter).toContain(`- pripojeny-A: ${linkedA}`);
  const b = await (await chat(clientB)).send("ses_b");
  expect(b).toContain(`- Hron podklady: ${linkedB}`);
  expect(b).not.toContain(linkedA);
  expect(b).not.toContain("Tatran");
});

test("pripomienka len pri zmene; po odpojení raz „už nie sú“; bez priečinkov žiadna; systémový text je pevný", async () => {
  const { clientA, writeMap } = await fixture();
  const session = await chat(clientA);
  expect(await session.send("ses_1")).toContain("pripojeny-A");
  expect(await session.send("ses_1")).toBe("");
  await writeMap([]);
  expect(await session.send("ses_1")).toContain("no linked folders any more");
  expect(await session.send("ses_1")).toBe("");
  expect(await (await chat(clientA)).send("ses_2")).toBe("");
  const again = await chat(clientA);
  expect(again.system).toEqual(session.system);
  expect(session.system.join("")).not.toContain("pripojeny-A");
});
