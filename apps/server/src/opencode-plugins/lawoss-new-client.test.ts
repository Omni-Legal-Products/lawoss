// LAWOSS #423: lawoss_new_client creates a client in the office through the server's client-form path, behind one card.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { z } from "zod";
import { adoptWikiAgentSecret, wikiAgentSecret } from "./wiki-agent-secret.js";
import MemoryTools from "./lawoss-memory-tools.js";
import { lawossNativePlugin } from "./lawoss-native-test-support.js";

type Card = { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> };
const TARGET = "/synthetic/Kancelaria/Klienti/Novák s. r. o";
const PLANNED = { id: "0f3c7a3e-6c1b-4a8e-9d55-1a2b3c4d5e6f", fingerprint: "c".repeat(64), office: "/synthetic/Kancelaria", parent: "/synthetic/Kancelaria/Klienti", target: TARGET, name: "Novák s. r. o.",
  clientType: "po", ico: "12345678", note: "Dodávateľ stavebnín" };
let requests: { path: string; body: Record<string, unknown> }[] = [];
let planReply: () => Response = () => Response.json(PLANNED);
let server: ReturnType<typeof Bun.serve>;
let oldUrl: string | undefined, oldToken = "";

beforeEach(() => {
  requests = []; oldUrl = process.env.LEGALWORK_SERVER_URL; oldToken = wikiAgentSecret();
  server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/workspaces") return Response.json({ items: [{ id: "client", path: "/synthetic/Kancelaria/Klienti/K1" }] });
    expect(request.headers.get("x-legalwork-wiki-agent-session")).toBe("ses_client");
    requests.push({ path: url.pathname, body: z.record(z.string(), z.unknown()).parse(await request.json()) });
    if (url.pathname.endsWith("/plan")) return planReply();
    return Response.json({ created: true, path: TARGET, name: "Novák s. r. o." });
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin; adoptWikiAgentSecret("fixture-token");
});
afterEach(() => {
  server.stop(true);
  if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
  adoptWikiAgentSecret(oldToken);
  planReply = () => Response.json(PLANNED);
});

const chat = (ask: (card: Card) => Promise<void>) => ({ directory: "/synthetic/Kancelaria/Klienti/K1", sessionID: "ses_client", ask });

test("success: plan from the chat's own client, one card with everything written, then apply of the same ticket", async () => {
  const plugin = await lawossNativePlugin(MemoryTools);
  expect(Object.keys(plugin.tool)).toContain("lawoss_new_client");
  const cards: Card[] = [];
  const result = JSON.parse(await plugin.tool.lawoss_new_client.execute({ name: "Novák s. r. o.", client_type: "po", ico: "12345678", note: "Dodávateľ stavebnín" }, chat(async card => { cards.push(card); })));
  expect(requests).toEqual([
    { path: "/workspace/client/lawoss/new-client/plan", body: { name: "Novák s. r. o.", clientType: "po", ico: "12345678", note: "Dodávateľ stavebnín" } },
    { path: "/workspace/client/lawoss/new-client/apply", body: { id: "0f3c7a3e-6c1b-4a8e-9d55-1a2b3c4d5e6f", fingerprint: "c".repeat(64), sessionID: "ses_client" } },
  ]);
  // Its own permission (always asks, also in YOLO); the card shows what the server will write, not the tool input.
  expect(cards).toEqual([{ permission: "lawoss_client_create", patterns: [TARGET], always: [],
    metadata: { lawossNewClient: { target: TARGET, name: "Novák s. r. o.", clientType: "po", ico: "12345678", note: "Dodávateľ stavebnín" } } }]);
  expect(result).toMatchObject({ created: true, path: TARGET, name: "Novák s. r. o." });
  expect(result.note).toContain("now appears in the client list");
  // Fixed text for the model, same bytes every turn (prompt caching).
  const fixed = (await plugin.system()).join("\n");
  expect(fixed).toContain("call lawoss_new_client with the client's name and its type");
  expect(fixed).toContain("when the name and the lawyer's words do not make the type clear, ask one short question first");
  expect(fixed).toContain("Never create a new client's folder or client card by hand");
  // The client form's handoff (compose-prompt.ts) names its target folder and stays valid.
  expect(fixed).toContain("unless a request from the LAWOSS client form names the exact target folder");
  // An existing folder of this chat is onboarded in place with /novy-spis, not offered to lawoss_new_client.
  expect(fixed).toContain("to bring this chat's own folder into the office standard, use the /novy-spis skill in place (okf plan klient . and, after approval, apply)");
  expect(fixed).toContain("do it only when the lawyer asks");
  expect((await plugin.system()).join("\n")).toBe(fixed);
});

test("declined card: nothing is applied; the engine reports the decline and the fixed text says nothing was created", async () => {
  const plugin = await lawossNativePlugin(MemoryTools);
  // nativeTool rethrows a card failure so the engine records the user's decision (as lawoss_memory_write).
  await expect(plugin.tool.lawoss_new_client.execute({ name: "Novák s. r. o.", client_type: "po" },
    chat(async () => { throw Object.assign(new Error("Permission.DeclinedError"), { _tag: "Permission.DeclinedError" }); }))).rejects.toThrow("Permission.DeclinedError");
  expect(requests.map(item => item.path)).toEqual(["/workspace/client/lawoss/new-client/plan"]);
  expect((await plugin.system()).join("\n")).toContain("If the lawyer declines the card, say plainly that no client was created");
});

test("no office connected and a name collision are refused before any card", async () => {
  const plugin = await lawossNativePlugin(MemoryTools);
  let asked = 0;
  planReply = () => Response.json({ code: "new_client_no_office", message: "No office is connected in LAWOSS, so a client cannot be created. Nothing was created." }, { status: 409 });
  const none = JSON.parse(await plugin.tool.lawoss_new_client.execute({ name: "Novák s. r. o.", client_type: "po" }, chat(async () => { asked++; })));
  expect(none).toMatchObject({ created: false, code: "new_client_no_office" });
  expect(none.note).toContain("connect their office");
  planReply = () => Response.json({ code: "new_client_exists", message: `A folder with this name already exists (${TARGET}). Nothing was created or overwritten.` }, { status: 409 });
  const taken = JSON.parse(await plugin.tool.lawoss_new_client.execute({ name: "Novák s. r. o.", client_type: "po" }, chat(async () => { asked++; })));
  expect(taken).toMatchObject({ created: false, code: "new_client_exists" });
  expect(taken.error).toContain("already exists");
  expect(taken.note).toContain("nothing was created or overwritten");
  expect(asked).toBe(0);
  expect(requests.every(item => item.path.endsWith("/plan"))).toBe(true);
});

test("the client type is required and never defaulted; the description tells the agent to ask when unclear", async () => {
  const plugin = await lawossNativePlugin(MemoryTools);
  await expect(plugin.tool.lawoss_new_client.execute({ name: "Novák" }, chat(async () => {}))).rejects.toThrow();
  expect(requests).toEqual([]);
  expect(plugin.tool.lawoss_new_client.description).toContain("The client type is required");
  expect(plugin.tool.lawoss_new_client.description).toContain("always, also in YOLO Mode");
});

test("an invalid name is reported as an invalid name, not as an existing client", async () => {
  const plugin = await lawossNativePlugin(MemoryTools);
  planReply = () => Response.json({ code: "new_client_name", message: "A client name cannot contain / or \\, start with a dot or consist only of dots. Nothing was created." }, { status: 400 });
  const refused = JSON.parse(await plugin.tool.lawoss_new_client.execute({ name: "..", client_type: "fo" }, chat(async () => { throw new Error("no card expected"); })));
  expect(refused).toMatchObject({ created: false, code: "new_client_name" });
  expect(refused.note).toContain("Ask the lawyer for the client's name");
});
