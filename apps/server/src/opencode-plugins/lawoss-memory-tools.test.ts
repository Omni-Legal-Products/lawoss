// LAWOSS alfa 2 (N-A3-3): lawoss_memory reads case memory through the server and never asks for approval.
import { expect, test } from "bun:test";
import { z } from "zod";
import { LAWOSS_MEMORY_TOOL } from "../lawoss/tool-permission-defaults.js";
import { LawossMemoryTools } from "./lawoss-memory-tools.js";

test("lawoss_memory posts the case folder of this chat to its own client and never shows a card", async () => {
  const oldUrl = process.env.LEGALWORK_SERVER_URL, oldToken = process.env.LEGALWORK_WIKI_AGENT_TOKEN;
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
  process.env.LEGALWORK_SERVER_URL = server.url.origin; process.env.LEGALWORK_WIKI_AGENT_TOKEN = "fixture-token";
  let asked = 0;
  try {
    const plugin = await LawossMemoryTools();
    expect(Object.keys(plugin.tool)).toEqual([LAWOSS_MEMORY_TOOL]);
    const tool = plugin.tool.lawoss_memory;
    const schema = z.object(tool.args), wire = z.fromJSONSchema(z.toJSONSchema(schema));
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
    expect(bodies).toHaveLength(4);
    expect(asked).toBe(0);
    // Fixed text for the model: memory and folder listing without the shell.
    const output = { system: [] as string[] };
    await plugin["experimental.chat.system.transform"]({}, output);
    expect(output.system.join("\n")).toContain("lawoss_memory");
    expect(output.system.join("\n")).toContain("instead of ls");
  } finally {
    server.stop(true);
    if (oldUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN; else process.env.LEGALWORK_WIKI_AGENT_TOKEN = oldToken;
  }
});
