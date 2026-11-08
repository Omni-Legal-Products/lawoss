import { nativePluginTools } from "./native-plugin-test-support.js";
const LegalWorkProjectTools = (context = {}) => nativePluginTools(LegalWorkProjectToolsDefinition, context);
import { expect, test } from "bun:test";
import { adoptWikiAgentSecret, wikiAgentSecret } from "./wiki-agent-secret.js";
import LegalWorkProjectToolsDefinition from "./legalwork-project-tools.js";

test("history provenance binds the actual caller, asks for the exact chat resource and retains complete records", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL, oldToken = wikiAgentSecret();
  const full = "preserved-reference".repeat(12_000); let read = 0;
  const server = Bun.serve({ port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/workspaces") return Response.json({ items: [{ id: "history", path: "/history" }] });
    expect(url.pathname).toBe("/workspace/history/sessions/ses_parent/history-provenance");
    expect(url.searchParams.get("callerSessionID")).toBe("ses_actual"); read++;
    return Response.json({ sessionID: "ses_parent", provenance: { version: 1, status: "available", messages: { msg_source: { attachments: [{ partID: "part", mime: "text/plain", bytes: "reference-only", reference: full }] } } } });
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin; adoptWikiAgentSecret("fixture");
  try {
    const plugin = await LegalWorkProjectTools({ directory: "/history" }), asks: unknown[] = [];
    const result = await plugin.tool.legalwork_history_provenance.execute({ sessionID: "ses_parent", callerSessionID: "ses_forged" }, { sessionID: "ses_actual", directory: "/history", ask: async input => { asks.push(input); } });
    expect(JSON.parse(result).provenance.messages.msg_source.attachments[0].reference).toBe(full);
    expect(asks).toMatchObject([{ permission: "legalwork_history_provenance", patterns: ["session:ses_parent"], always: ["session:ses_parent"] }]);
    await expect(plugin.tool.legalwork_history_provenance.execute({ sessionID: "ses_parent" }, { sessionID: "ses_actual", directory: "/history", ask: async () => { throw new Error("History denied"); } })).rejects.toThrow("History denied"); expect(read).toBe(1);
    await plugin.runtime.close();
  } finally { server.stop(true); if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl; adoptWikiAgentSecret(oldToken ?? ""); }
});

test("document read rejects paths recoverably before transport and reads only listed UUIDs", async () => {
  const { z } = await import("zod");
  const oldUrl = process.env.LEGALWORK_SERVER_URL, oldToken = wikiAgentSecret();
  const id = "00000000-0000-4000-8000-000000000001";
  let documentReads = 0, permissionRequests = 0;
  const server = Bun.serve({ port: 0, fetch(request) {
    const url = new URL(request.url);
    expect(request.headers.get("x-legalwork-wiki-agent-session")).toBe("synthetic-session");
    if (url.pathname === "/workspaces") return Response.json({ items: [{ id: "synthetic", path: "/synthetic" }] });
    if (url.pathname === "/workspace/synthetic/lawoss/documents") return Response.json({ documents: [{ id }], nextOffset: null });
    expect(url.pathname).toBe(`/workspace/synthetic/lawoss/documents/${id}/read`);
    documentReads++;
    return Response.json({ text: "Synthetic listed evidence", nextOffset: null, complete: true, untrusted: true });
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin; adoptWikiAgentSecret("synthetic-token");
  try {
    const plugin = await LegalWorkProjectTools(), tool = plugin.tool.lawoss_documents_read;
    const wire = z.fromJSONSchema(JSON.parse(JSON.stringify(tool.input)));
    const context = { directory: "/synthetic", sessionID: "synthetic-session", ask: async () => { permissionRequests++; } };
    for (const value of ["email/message.eml", "contract.pdf", "", "not-a-uuid"]) {
      expect(wire.safeParse({ id: value }).success).toBe(false);
      const result = JSON.parse(await tool.execute({ id: value }, context));
      expect(result.code).toBe("document_arguments"); expect(result.nextTool).toBe("lawoss_documents_list");
    }
    expect(documentReads).toBe(0);
    const listed = JSON.parse(await plugin.tool.lawoss_documents_list.execute({}, context));
    const read = JSON.parse(await tool.execute({ id: listed.documents[0].id }, context));
    expect(read.text).toBe("Synthetic listed evidence"); expect(documentReads).toBe(1); expect(permissionRequests).toBe(0);
    // OpenCode 2 always names the calling chat; the server binds every read to it.
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    adoptWikiAgentSecret(oldToken);
  }
});

test("project tools resolve the closest project, carry pagination and reject unrelated directories", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL;
  const oldToken = wikiAgentSecret();
  const requests: string[] = [];
  const directories: Array<string | null> = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      // The chat-bound credential only, never a server-wide token.
      expect(request.headers.get("x-legalwork-wiki-agent-token")).toBe("fixture-token");
      expect(request.headers.get("x-legalwork-wiki-agent-session")).toBe("ses_project");
      expect(request.headers.has("Authorization")).toBe(false);
      directories.push(request.headers.get("x-legalwork-wiki-agent-directory"));
      const url = new URL(request.url);
      if (url.pathname === "/workspaces") return Response.json({ items: [
        { id: "parent", path: "/matters" }, { id: "child", path: "/matters/current" },
      ] });
      requests.push(url.pathname + url.search);
      return Response.json({ version: 1, project: { id: "child", name: "Example", fields: [] }, sections: [] });
    },
  });
  process.env.LEGALWORK_SERVER_URL = server.url.origin;
  adoptWikiAgentSecret("fixture-token");
  try {
    const plugin = await LegalWorkProjectTools();
    const output = { system: [] };
    await plugin.runtime.hook("session", "context", output);
    expect(output.system.map((item: {text:string})=>item.text).join(" ")).toContain("untrusted");
    expect(output.system.map((item: {text:string})=>item.text).join(" ")).toContain("interactive cards");
    expect(output.system.map((item: {text:string})=>item.text).join(" ")).toContain("Do not assume the current project's recordings are the full library");
    expect(plugin.tool).toHaveProperty("legalwork_recordings_list");
    expect(plugin.tool).toHaveProperty("legalwork_recording_read");
    const result = await plugin.tool.legalwork_project_list.execute({ kind: "notes", cursor: "Notes/Page 1.md" }, { directory: "/matters/current/subfolder", sessionID: "ses_project" });
    expect(JSON.parse(result).project.id).toBe("child");
    expect(directories.at(-1)).toBe(encodeURIComponent("/matters/current/subfolder"));
    expect(requests[0]).toContain("/workspace/child/project/contents?");
    expect(requests[0]).toContain("cursor=Notes%2FPage+1.md");
    await plugin.tool.legalwork_project_read.execute({ kind: "recordings", id: "rec-1", offset: 12000 }, { directory: "/matters/current", sessionID: "ses_project" });
    expect(requests[1]).toContain("kind=recordings&id=rec-1&offset=12000");
    const rejected = await plugin.tool.legalwork_project_list.execute({}, { directory: "/outside", sessionID: "ses_project" });
    expect(JSON.parse(rejected).error).toContain("not inside");
    expect(requests.length).toBe(2);
    // OpenCode 2 always names the calling chat, so a call without one cannot occur.
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    adoptWikiAgentSecret(oldToken);
  }
});

test("sessions receive folder configuration and can finish setup without storing a summary", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL;
  const oldToken = wikiAgentSecret();
  let saved = false;
  const server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/workspaces") return Response.json({ items: [{ id: "mapped", path: "/mapped-project" }] });
    expect(url.pathname).toBe("/workspace/mapped/project/setup");
    if (request.method === "PATCH") {
      expect(request.headers.get("x-legalwork-wiki-agent-token")).toBe("fixture-token");
      expect(request.headers.get("x-legalwork-wiki-agent-session")).toBe("ses_project");
      expect(request.headers.get("x-legalwork-wiki-agent-directory")).toBe(encodeURIComponent("/mapped-project"));
      expect(request.headers.has("authorization")).toBe(false);
      const body = await request.json();
      expect(body.revision).toBe(2); expect(body.name).toBe("New matter name");
      expect(body).not.toHaveProperty("context"); saved = true;
    }
    return Response.json({ revision: 2, remote: { initialization: saved ? "ready" : "pending", folders: [{ id: "mapped-folder" }] } });
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin;
  adoptWikiAgentSecret("fixture-token");
  try {
    const plugin = await LegalWorkProjectTools({ directory: "/mapped-project" });
    const systemText = async () => {
      const output: { system: Array<{type:"text";text:string}> } = { system: [] };
      await plugin.runtime.hook("session", "context", output);
      return output.system.map((item: {text:string})=>item.text).join(" ");
    };
    const before = await systemText();
    expect(plugin.tool).not.toHaveProperty("legalwork_project_set_context");
    expect(plugin.tool).not.toHaveProperty("legalwork_project_get_context");
    expect(before).toContain("DEFAULT scope");
    expect(before).toContain("independent of LegalMemory");
    // The configuration itself changes during setup, so it arrives as a reminder.
    expect(before).not.toContain('"initialization"');
    const message = { sessionID: "ses_project", messageID:"msg_test", prompt:{text:"Set up the project"} };
    await plugin.runtime.hook("session", "prompt", message);
    expect(message.prompt.text).toContain('"initialization":"pending"');

    const result = { sessionID:"ses_project",status:"completed",result:{content: await plugin.tool.legalwork_project_complete_setup.execute({ revision: 2, name: "New matter name" }, { directory: "/mapped-project", sessionID: "ses_project" }) } };
    await plugin.runtime.hook("tool", "execute.after", result);
    expect(JSON.stringify(result.result)).toContain('system-reminder topic=\\"project\\"');
    expect(JSON.stringify(result.result)).toContain('\\"initialization\\":\\"ready\\"');
    expect(JSON.stringify(result.result)).not.toContain("saved context");
    expect(await systemText()).toBe(before);
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    adoptWikiAgentSecret(oldToken);
  }
});

test("document export native advertised schema accepts only empty absence or exact lowercase hash", async () => {
  const { z } = await import("zod");
  const module = await import("./legalwork-project-tools.js");
  expect(Object.keys(module)).toEqual(["default"]);
  const plugin = await LegalWorkProjectTools(), tool = plugin.tool.lawoss_documents_export;
  const advertised = z.fromJSONSchema(JSON.parse(JSON.stringify(tool.input))), args = advertised;
  const base = { path: "synthetic.csv", kind: "registry", outputLanguage: "cs", documentIds: ["00000000-0000-4000-8000-000000000001"], entries: [] };
  expect(args.safeParse(base).success).toBe(true); expect(advertised.safeParse(base).success).toBe(true);
  for (const expectedHash of ["", "a".repeat(64)]) {
    expect(args.safeParse({ ...base, expectedHash }).success).toBe(true);
    expect(advertised.safeParse({ ...base, expectedHash }).success).toBe(true);
  }
  for (const expectedHash of [null, " ", "wrong", "a".repeat(63), "a".repeat(65), "A".repeat(64), 0]) {
    expect(args.safeParse({ ...base, expectedHash }).success).toBe(false);
    expect(advertised.safeParse({ ...base, expectedHash }).success).toBe(false);
  }
  expect(tool.description).toContain("create-only");
  expect(plugin.tool.lawoss_documents_list.description).toContain("50");
  expect(plugin.tool.lawoss_documents_read.description).toContain("characters");
  expect(plugin.tool.lawoss_documents_read.description).toContain("16000");
});

test("document export forwards missing/empty hashes with property fully absent and valid hashes unchanged", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL, oldToken = wikiAgentSecret();
  const bodies: unknown[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    expect(request.headers.has("authorization")).toBe(false);
    expect(request.headers.get("x-legalwork-wiki-agent-token")).toBe("synthetic-model-token");
    if(request.headers.get("x-legalwork-wiki-agent-session")==="foreign-session")return Response.json({code:"wiki_agent_session_forbidden"},{status:403});
    expect(request.headers.get("x-legalwork-wiki-agent-session")).toBe("synthetic-session");
    expect(request.headers.get("x-legalwork-wiki-agent-directory")).toBe(encodeURIComponent("/synthetic"));
    if (new URL(request.url).pathname === "/workspaces") return Response.json({ items: [{ id: "synthetic", path: "/synthetic" }] });
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/workspace/synthetic/lawoss/documents/export");
    bodies.push(await request.json());
    // Transport receipt only: does not pretend to prove a saved export.
    return Response.json({ received: true });
  } });
  process.env.LEGALWORK_SERVER_URL = server.url.origin; adoptWikiAgentSecret("synthetic-model-token");
  try {
    const { z } = await import("zod"), plugin = await LegalWorkProjectTools(), tool = plugin.tool.lawoss_documents_export;
    const args = z.fromJSONSchema(JSON.parse(JSON.stringify(tool.input))), base = { path: "synthetic.csv", kind: "registry", outputLanguage: "cs", documentIds: ["00000000-0000-4000-8000-000000000001"], entries: [] };
    for (const input of [base, { ...base, expectedHash: "" }, { ...base, expectedHash: "a".repeat(64) }]) await tool.execute(args.parse(input), { directory: "/synthetic", sessionID: "synthetic-session" });
    expect(bodies).toEqual([base, base, { ...base, expectedHash: "a".repeat(64) }]);
    expect(Object.hasOwn(bodies[0]!, "expectedHash")).toBe(false); expect(Object.hasOwn(bodies[1]!, "expectedHash")).toBe(false);
    for (const expectedHash of [null, " ", "wrong", "A".repeat(64)]) await expect(tool.execute({ ...base, expectedHash }, { directory: "/synthetic", sessionID: "synthetic-session" })).rejects.toThrow();
    expect(bodies).toHaveLength(3);
    // OpenCode 2 always names the calling chat; a foreign chat is refused by the server.
    const foreign = await tool.execute(args.parse(base), { directory: "/synthetic", sessionID: "foreign-session" });
    expect(JSON.parse(foreign).error).toContain("403");
    expect(bodies).toHaveLength(3);
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    adoptWikiAgentSecret(oldToken);
  }
});
