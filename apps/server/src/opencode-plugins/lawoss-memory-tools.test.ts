// LAWOSS alfa 2 (N-A3-3): lawoss_memory reads case memory through the server and never asks for approval.
import { expect, test } from "bun:test";
import { adoptWikiAgentSecret, wikiAgentSecret } from "./wiki-agent-secret.js";
import { z } from "zod";
import { LAWOSS_MEMORY_TOOL } from "../lawoss/tool-permission-defaults.js";
import MemoryTools from "./lawoss-memory-tools.js";
import { lawossNativePlugin } from "./lawoss-native-test-support.js";
import { nativeToolBefore } from "./native-plugin-test-support.js";

test("lawoss_memory posts the case folder of this chat to its own client and never shows a card", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL, oldToken = wikiAgentSecret();
  const bodies: unknown[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url);
    expect(request.headers.get("x-legalwork-wiki-agent-token")).toBe("fixture-token");
    expect(request.headers.get("x-legalwork-wiki-agent-session")).toBe("ses_memory");
    if (url.pathname === "/workspaces") return Response.json({ items: [{ id: "practice", path: "/synthetic" }, { id: "client", path: "/synthetic/K1" }] });
    expect(request.method).toBe("POST");
    expect(url.pathname).toBe("/workspace/client/lawoss/memory/read");
    expect(url.search).toBe("");
    const body = await request.json();
    bodies.push(body);
    if (z.object({ matter: z.string() }).parse(body).matter.includes("Cudzi")) return Response.json({ code: "memory_folder_not_own", message: "Nothing was read." }, { status: 403 });
    return Response.json({ action: "read", complete: true, text: "SYN pamäť", nextOffset: null, untrusted: true });
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin; adoptWikiAgentSecret("fixture-token");
  let asked = 0;
  try {
    const plugin = await lawossNativePlugin(MemoryTools);
    // Reading has its own tool; writing is lawoss_memory_write with one card (N-A7-10).
    expect(Object.keys(plugin.tool)).toEqual([LAWOSS_MEMORY_TOOL, "lawoss_memory_write", "lawoss_memory_deadline", "lawoss_new_client", "lawoss_integrations"]);
    const tool = plugin.tool.lawoss_memory;
    const wire = z.fromJSONSchema(JSON.parse(JSON.stringify(tool.input)));
    expect(wire.safeParse({ action: "write" }).success).toBe(false);
    expect(wire.safeParse({ action: "preamble" }).success).toBe(true);
    // A case chat runs in the case folder; a path written from the client root is not doubled.
    const context = { directory: "/synthetic/K1/Spisy/M001", sessionID: "ses_memory", ask: async () => { asked++; } };
    expect(JSON.parse(await tool.execute({ action: "preamble" }, context))).toMatchObject({ text: "SYN pamäť" });
    await tool.execute({ action: "read", matter: "Spisy/M001", offset: 40000 }, context);
    await tool.execute({ action: "read", matter: "../M002" }, context);
    expect(bodies).toEqual([
      { action: "preamble", matter: "/synthetic/K1/Spisy/M001" },
      { action: "read", matter: "/synthetic/K1/Spisy/M001", offset: 40000 },
      { action: "read", matter: "/synthetic/K1/Spisy/M002" },
    ]);
    const refused = JSON.parse(await tool.execute({ action: "read", matter: "/synthetic/Cudzi" }, context));
    expect(refused.error).toContain("403");
    expect(JSON.parse(await tool.execute({ action: "write" }, context))).toMatchObject({ code: "memory_arguments" });
    // #481: an unknown argument such as caseFolder is refused with the actionable text, never read from this chat's folder.
    const unknown = JSON.parse(await tool.execute({ action: "read", caseFolder: "Spisy/M001" }, context));
    expect(unknown).toMatchObject({ code: "memory_arguments" });
    expect(unknown.error).toContain("caseFolder");
    expect(unknown.error).toContain("matter");
    // #526: the model gets the exact schema without additionalProperties; the engine decodes a call with it and drops
    // caseFolder, which execute.before saw in the raw call, so the decoded call is refused as well.
    expect(tool.input).not.toHaveProperty("additionalProperties");
    expect(wire.safeParse({ action: "read", caseFolder: "Spisy/M001" }).success).toBe(true);
    await nativeToolBefore(plugin.runtime, LAWOSS_MEMORY_TOOL, { action: "read", caseFolder: "Spisy/M001" }, "ses_memory");
    const dropped = JSON.parse(await tool.execute({ action: "read" }, context));
    expect(dropped).toMatchObject({ code: "memory_arguments" });
    expect(dropped.error).toContain("caseFolder");
    // Only that call: the next one without an unknown argument reads as before.
    await nativeToolBefore(plugin.runtime, LAWOSS_MEMORY_TOOL, { action: "preamble" }, "ses_memory");
    expect(JSON.parse(await tool.execute({ action: "preamble" }, context))).toMatchObject({ text: "SYN pamäť" });
    expect(bodies).toHaveLength(5);
    expect(asked).toBe(0);
    // Fixed text for the model: memory and folder listing without the shell.
    const output = { system: await plugin.system() };
    expect(output.system.join("\n")).toContain("lawoss_memory");
    expect(output.system.join("\n")).toContain("instead of ls");
    expect(output.system.join("\n")).toContain("call lawoss_memory_write");
    // N-A7-7: glob lists files only (rg --files), so an empty folder such as 02_Resers/prazdny-SYN is seen with read
    // on the folder path; opencode v1.18.29 read lists subfolders with a trailing / and an empty one as (0 entries).
    expect(output.system.join("\n")).toContain("glob and grep return files only, so an empty folder never appears in their results.");
    expect(output.system.join("\n")).toContain("call read on the folder's path");
    expect(output.system.join("\n")).toContain("subfolders with a trailing /, and an empty folder shows (0 entries)");
    expect(output.system.join("\n")).toContain("Never conclude that a folder is missing from glob or grep alone.");
    // MČ 10. 11. 2026: a note for the whole client, a deadline the lawyer states, tidying what is unfiled, plain language.
    const fixed = output.system.join("\n");
    expect(fixed).toContain("call lawoss_memory_write with scope client and a record of type client_note");
    expect(fixed).toContain("call lawoss_memory_deadline once");
    expect(fixed).toContain("Never derive or compute a deadline");
    expect(fixed).toContain("do not stop at an empty intake folder (00_Na_zatriedenie)");
    expect(fixed).toContain("rows with the state pending in the input register VSTUPY.md of the client's folder and of every case");
    expect(fixed).toContain("Speak to the lawyer in plain language.");
    expect(fixed).toContain("say in one sentence what the user can do next");
    // #426: a client without Spisy/ (not onboarded) has no case memory; the agent must not invent or describe it.
    expect(fixed).toContain("A client folder without a Spisy/ folder, without a client card and without a memory/ folder is not yet onboarded into the office standard and has no case memory.");
    expect(fixed).toContain("say plainly that this client has no case memory yet, so no deadlines are recorded in case memory for it");
    // Tasks created in the app live outside case memory: never claim that the client has none.
    expect(fixed).toContain("Do not say that the client has no deadlines or tasks at all: tasks created in the app are kept outside case memory.");
    expect(fixed).not.toContain("no deadlines or tasks are recorded for this client");
    expect(fixed).toContain("Never say that memory, a register or records of this client exist and never describe what they contain.");
    // #426 + #423: onboarding an existing folder is the in-place /novy-spis conversion, never lawoss_new_client.
    expect(fixed).toContain("to bring the folder into the office standard in place with the /novy-spis skill (okf plan klient . and, after approval, apply), which only adds the missing files and never moves or overwrites the lawyer's documents. lawoss_new_client cannot do this");
    // The text is fixed: a second read gives the same bytes (prompt caching).
    expect((await plugin.system()).join("\n")).toBe(fixed);
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    adoptWikiAgentSecret(oldToken);
  }
});

// MČ 10. 11. 2026: a client-level note and a deadline from the lawyer's instruction each show exactly one card.
test("lawoss_memory_write with scope client and lawoss_memory_deadline: one card each, then the same request with apply", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL, oldToken = wikiAgentSecret();
  const bodies: Record<string, unknown>[] = [];
  const note = { status: "preview", target: "memory/CN-001-komunikacia.md", kind: "create", title: "Komunikácia s klientom", type: "client_note",
    truth: "Klient chce komunikovať len e-mailom.", history: ["2026-11-10 — založené"], fields: ["type: client_note"], reason: "Pokyn advokáta", approved: "a".repeat(64), scope: "client" };
  const due = { status: "preview", target: "Spisy/M001/memory/T-001-odpoved-protistrane.md", kind: "create", title: "Odpoveď protistrane", type: "task",
    truth: "Lehota 2026-11-25: Odpoveď protistrane. Zapísané podľa pokynu advokáta v chate (IN-002), neoverené z listiny.", history: [], fields: [], reason: "Pokyn advokáta v chate (IN-002)", approved: "b".repeat(64),
    deadline: { case: "Spor o úhradu dodávok", date: "2026-11-25", what: "Odpoveď protistrane", basis: "lawyer_instruction", register: "Spisy/M001/VSTUPY.md", inputId: "IN-002" } };
  const server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/workspaces") return Response.json({ items: [{ id: "client", path: "/synthetic/K1" }] });
    expect(url.pathname).toBe("/workspace/client/lawoss/memory/write");
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
    bodies.push(body);
    if (body.apply) return Response.json({ status: "written", target: body.kind ? due.target : note.target, id: body.kind ? "T-001" : "CN-001", text: "ok" });
    return Response.json(body.kind ? due : note);
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin; adoptWikiAgentSecret("fixture-token");
  try {
    const plugin = await lawossNativePlugin(MemoryTools);
    const cards: { permission: string; patterns: string[]; metadata: Record<string, unknown> }[] = [];
    const context = { directory: "/synthetic/K1", sessionID: "ses_memory", ask: async (card: { permission: string; patterns: string[]; metadata: Record<string, unknown> }) => { cards.push(card); } };
    // The model sees the scope and the deadline arguments; a date that is not YYYY-MM-DD never reaches the server.
    const writeWire = z.fromJSONSchema(JSON.parse(JSON.stringify(plugin.tool.lawoss_memory_write.input)));
    expect(writeWire.safeParse({ record: "x", reason: "y", scope: "client" }).success).toBe(true);
    expect(writeWire.safeParse({ record: "x", reason: "y", scope: "office" }).success).toBe(false);
    const wire = z.fromJSONSchema(JSON.parse(JSON.stringify(plugin.tool.lawoss_memory_deadline.input)));
    expect(wire.safeParse({ date: "2026-11-25", what: "Odpoveď protistrane", instruction: "do 25. novembra" }).success).toBe(true);
    expect(wire.safeParse({ date: "25. novembra", what: "Odpoveď protistrane", instruction: "do 25. novembra" }).success).toBe(false);
    expect(wire.safeParse({ what: "Odpoveď protistrane", instruction: "čo najskôr" }).success).toBe(false);

    await plugin.tool.lawoss_memory_write.execute({ record: "---\nokf: 1\n---", reason: "Pokyn advokáta", scope: "client" }, context);
    expect(bodies[0]).toMatchObject({ matter: "/synthetic/K1", scope: "client", reason: "Pokyn advokáta" });
    expect(bodies[1]).toMatchObject({ scope: "client", apply: true, approved: "a".repeat(64) });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ permission: "lawoss_file_change", patterns: ["memory/CN-001-komunikacia.md"], metadata: { lawossMemory: { scope: "client", type: "client_note" } } });

    const result = JSON.parse(await plugin.tool.lawoss_memory_deadline.execute(
      { date: "2026-11-25", what: "Odpoveď protistrane", instruction: "odpovedať protistrane do 25. novembra", matter: "Spisy/M001" }, context));
    expect(bodies[2]).toEqual({ kind: "instruction_deadline", matter: "/synthetic/K1/Spisy/M001", date: "2026-11-25", what: "Odpoveď protistrane",
      instruction: "odpovedať protistrane do 25. novembra", sessionID: "ses_memory" });
    expect(bodies[3]).toMatchObject({ kind: "instruction_deadline", apply: true, approved: "b".repeat(64) });
    // One card for both files, with the case, the date, what it is for and the marker; the token is not in it.
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({ permission: "lawoss_file_change", patterns: ["Spisy/M001/memory/T-001-odpoved-protistrane.md", "Spisy/M001/VSTUPY.md"],
      metadata: { lawossMemory: { deadline: { case: "Spor o úhradu dodávok", date: "2026-11-25", what: "Odpoveď protistrane", basis: "lawyer_instruction", register: "Spisy/M001/VSTUPY.md" } } } });
    expect(JSON.stringify(cards)).not.toContain("approved");
    expect(result).toMatchObject({ written: true, target: "Spisy/M001/memory/T-001-odpoved-protistrane.md" });

    // Declined: the card throws and the write request is never sent.
    const sent = bodies.length;
    await expect(plugin.tool.lawoss_memory_deadline.execute({ date: "2026-11-25", what: "Odpoveď protistrane", instruction: "do 25. novembra", matter: "Spisy/M001" },
      { ...context, ask: async () => { throw new Error("rejected"); } })).rejects.toThrow("rejected");
    expect(bodies.slice(sent)).toHaveLength(1);
    expect(bodies[sent]?.apply).toBeUndefined();
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    adoptWikiAgentSecret(oldToken);
  }
});

// #417: a new task of a case is registered like a deadline; its card names the case and covers both files.
test("lawoss_memory_write of a new task: one card with the case and both files, then apply", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL, oldToken = wikiAgentSecret();
  const bodies: Record<string, unknown>[] = [];
  const task = { status: "preview", target: "Spisy/M001/memory/T-001-vyziadat-prilohu.md", kind: "create", title: "Vyžiadať prílohu č. 4", type: "task",
    truth: "Pripomeň mi vyžiadať prílohu č. 4 do stredy.", history: [], fields: ["due: 2026-11-18"], reason: "Pokyn advokáta v chate", approved: "c".repeat(64),
    task: { case: "Spor o úhradu dodávok", register: "Spisy/M001/VSTUPY.md", inputId: "IN-002", instruction: "Pripomeň mi vyžiadať prílohu č. 4 do stredy." } };
  const server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/workspaces") return Response.json({ items: [{ id: "client", path: "/synthetic/K1" }] });
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
    bodies.push(body);
    if (body.apply) return Response.json({ status: "written", target: task.target, id: "T-001", text: "ok", register: "Spisy/M001/VSTUPY.md", inputId: "IN-002" });
    return Response.json(task);
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin; adoptWikiAgentSecret("fixture-token");
  try {
    const plugin = await lawossNativePlugin(MemoryTools);
    const cards: { permission: string; patterns: string[]; metadata: Record<string, unknown> }[] = [];
    const context = { directory: "/synthetic/K1", sessionID: "ses_memory", ask: async (card: { permission: string; patterns: string[]; metadata: Record<string, unknown> }) => { cards.push(card); } };
    await plugin.tool.lawoss_memory_write.execute({ record: "---\nokf: 1\n---", reason: "Pokyn advokáta v chate", matter: "Spisy/M001", instruction: task.truth }, context);
    // The lawyer's sentence reaches the server in both calls; without it the server registers no instruction.
    expect(bodies[0]).toMatchObject({ instruction: task.truth });
    expect(bodies[1]).toMatchObject({ apply: true, approved: "c".repeat(64), instruction: task.truth });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ permission: "lawoss_file_change", patterns: ["Spisy/M001/memory/T-001-vyziadat-prilohu.md", "Spisy/M001/VSTUPY.md"],
      metadata: { lawossMemory: { type: "task", task: { case: "Spor o úhradu dodávok", register: "Spisy/M001/VSTUPY.md", inputId: "IN-002", instruction: task.truth } } } });
    expect(JSON.stringify(cards)).not.toContain("approved");
    // A blank sentence is refused with a clear message before any request; the model sees the constraint too.
    const sent = bodies.length;
    for (const tool of ["lawoss_memory_write", "lawoss_memory_deadline"] as const) {
      const input = tool === "lawoss_memory_write" ? { record: "x", reason: "y", matter: "Spisy/M001", instruction: " \n " } : { date: "2026-11-25", what: "Odpoveď", matter: "Spisy/M001", instruction: "   " };
      await expect(plugin.tool[tool].execute(input, context)).rejects.toThrow("instruction is empty");
      expect(z.fromJSONSchema(JSON.parse(JSON.stringify(plugin.tool[tool].input))).safeParse(input).success).toBe(false);
      // #444: only `|` or control characters is no sentence either (the register cell would be empty).
      for (const instruction of ["|", " | \u0001 "]) await expect(plugin.tool[tool].execute({ ...input, instruction }, context)).rejects.toThrow("instruction is empty");
    }
    expect(bodies).toHaveLength(sent);
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    adoptWikiAgentSecret(oldToken);
  }
});
