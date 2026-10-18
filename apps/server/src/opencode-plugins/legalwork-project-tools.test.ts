import { expect, test } from "bun:test";
import { LegalWorkProjectTools } from "./legalwork-project-tools.js";

test("project tools resolve the closest project, carry pagination and reject unrelated directories", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL;
  const oldToken = process.env.LEGALWORK_WIKI_AGENT_TOKEN;
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
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = "fixture-token";
  try {
    const plugin = await LegalWorkProjectTools();
    const output = { system: [] };
    await plugin["experimental.chat.system.transform"]({}, output);
    expect(output.system.join(" ")).toContain("untrusted");
    expect(output.system.join(" ")).toContain("interactive cards");
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
    // A call that does not name its chat has no server connection at all.
    const unbound = await plugin.tool.legalwork_project_list.execute({}, { directory: "/matters/current" });
    expect(JSON.parse(unbound).error).toContain("not configured");
    const templates = await plugin.tool.legalwork_project_templates.execute({}, { directory: "/matters/current" });
    expect(JSON.parse(templates).error).toContain("not configured");
    expect(requests.length).toBe(2);
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN; else process.env.LEGALWORK_WIKI_AGENT_TOKEN = oldToken;
  }
});

test("sessions receive folder configuration and can finish setup without storing a summary", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL;
  const oldToken = process.env.LEGALWORK_WIKI_AGENT_TOKEN;
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
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = "fixture-token";
  try {
    const plugin = await LegalWorkProjectTools({ directory: "/mapped-project" });
    const systemText = async () => {
      const output: { system: string[] } = { system: [] };
      await plugin["experimental.chat.system.transform"]({}, output);
      return output.system.join(" ");
    };
    const before = await systemText();
    expect(plugin.tool).not.toHaveProperty("legalwork_project_set_context");
    expect(plugin.tool).not.toHaveProperty("legalwork_project_get_context");
    expect(before).toContain("DEFAULT scope");
    expect(before).toContain("independent of LegalMemory");
    // The configuration itself changes during setup, so it arrives as a reminder.
    expect(before).not.toContain('"initialization"');
    const message: { message: { id: string }; parts: object[] } = { message: { id: "msg_test" }, parts: [] };
    await plugin["chat.message"]({ sessionID: "ses_project" }, message);
    expect(message.parts.map((part) => String(Reflect.get(part, "text"))).join(" ")).toContain('"initialization":"pending"');

    const result = { output: await plugin.tool.legalwork_project_complete_setup.execute({ revision: 2, name: "New matter name" }, { directory: "/mapped-project", sessionID: "ses_project" }) };
    await plugin["tool.execute.after"]({ sessionID: "ses_project" }, result);
    expect(result.output).toContain('<system-reminder topic="project">');
    expect(result.output).toContain('"initialization":"ready"');
    expect(result.output).not.toContain("saved context");
    expect(await systemText()).toBe(before);
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN; else process.env.LEGALWORK_WIKI_AGENT_TOKEN = oldToken;
  }
});

test("document export native advertised schema accepts only empty absence or exact lowercase hash", async () => {
  const { z } = await import("zod");
  const module = await import("./legalwork-project-tools.js");
  expect(Object.keys(module)).toEqual(["LegalWorkProjectTools"]);
  const plugin = await LegalWorkProjectTools(), tool = plugin.tool.lawoss_documents_export;
  const args = z.object(tool.args), advertised = z.fromJSONSchema(z.toJSONSchema(args));
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
  const oldUrl = process.env.LEGALWORK_SERVER_URL, oldToken = process.env.LEGALWORK_WIKI_AGENT_TOKEN;
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
  process.env.LEGALWORK_SERVER_URL = server.url.origin; process.env.LEGALWORK_WIKI_AGENT_TOKEN = "synthetic-model-token";
  try {
    const { z } = await import("zod"), plugin = await LegalWorkProjectTools(), tool = plugin.tool.lawoss_documents_export;
    const args = z.object(tool.args), base = { path: "synthetic.csv", kind: "registry", outputLanguage: "cs", documentIds: ["00000000-0000-4000-8000-000000000001"], entries: [] };
    for (const input of [base, { ...base, expectedHash: "" }, { ...base, expectedHash: "a".repeat(64) }]) await tool.execute(args.parse(input), { directory: "/synthetic", sessionID: "synthetic-session" });
    expect(bodies).toEqual([base, base, { ...base, expectedHash: "a".repeat(64) }]);
    expect(Object.hasOwn(bodies[0]!, "expectedHash")).toBe(false); expect(Object.hasOwn(bodies[1]!, "expectedHash")).toBe(false);
    for (const expectedHash of [null, " ", "wrong", "A".repeat(64)]) expect(() => tool.execute({ ...base, expectedHash }, { directory: "/synthetic", sessionID: "synthetic-session" })).toThrow();
    expect(bodies).toHaveLength(3);
    const unbound = await tool.execute(args.parse(base), { directory: "/synthetic" });
    expect(JSON.parse(unbound).error).toContain("not configured");
    const foreign = await tool.execute(args.parse(base), { directory: "/synthetic", sessionID: "foreign-session" });
    expect(JSON.parse(foreign).error).toContain("403");
    expect(bodies).toHaveLength(3);
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN; else process.env.LEGALWORK_WIKI_AGENT_TOKEN = oldToken;
  }
});
