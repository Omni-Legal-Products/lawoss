import { describe, expect, test } from "bun:test";
import { LegalWorkCapabilitiesKnowledge } from "./legalwork-capabilities-knowledge.js";

describe("LegalWork capabilities knowledge plugin", () => {
  test("injects local desktop product guidance", async () => {
    const plugin = await LegalWorkCapabilitiesKnowledge();
    const output: { system: string[] } = { system: [] };

    await plugin["experimental.chat.system.transform"](null, output);

    expect(output.system.join("\n")).toContain("local-first desktop app");
    expect(output.system.join("\n")).toContain("workspace-relative path");
  });

  test("reports the project prompt as a reminder, resolving Windows project paths without matching neighbouring folders", async () => {
    const previousUrl = process.env.LEGALWORK_SERVER_URL;
    const previousToken = process.env.LEGALWORK_WIKI_AGENT_TOKEN;
    let requestCount = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        // The reminder asks as the chat it is for, never with a server-wide token.
        expect(request.headers.get("x-legalwork-wiki-agent-token")).toBe("test-token");
        expect(request.headers.get("x-legalwork-wiki-agent-session")).toBe("ses_project");
        expect(request.headers.has("x-legalwork-wiki-agent-directory")).toBe(true);
        expect(request.headers.has("authorization")).toBe(false);
        requestCount++;
        const path = new URL(request.url).pathname;
        if (path === "/workspaces") return Response.json({ items: [
          { id: "parent", path: "C:\\Matters\\Acme\\" },
          { id: "nested", path: "C:\\Matters\\Acme\\Contracts" },
        ] });
        if (path === "/workspace/parent/personalization") return parentStyle === null ? new Response(null, { status: 503 }) : Response.json({ customInstructions: parentStyle });
        if (path === "/workspace/nested/personalization") return Response.json({ customInstructions: "Nested writing style" });
        return new Response(null, { status: 404 });
      },
    });
    process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
    process.env.LEGALWORK_WIKI_AGENT_TOKEN = "test-token";
    /** The fixed system text and the reminder on the next user message. */
    const modelContext = async (plugin: Awaited<ReturnType<typeof LegalWorkCapabilitiesKnowledge>>) => {
      const output: { system: string[] } = { system: [] };
      await plugin["experimental.chat.system.transform"](null, output);
      const message: { message: { id: string }; parts: object[] } = { message: { id: "msg_test" }, parts: [] };
      await plugin["chat.message"]({ sessionID: "ses_project" }, message);
      return { system: output.system.join("\n"), reminder: message.parts.map((part) => String(Reflect.get(part, "text"))).join("\n") };
    };
    const prompt = async (directory: string) => (await modelContext(await LegalWorkCapabilitiesKnowledge({ directory }))).reminder;
    let parentStyle: string | null = "Parent writing style";
    try {
      const parent = await LegalWorkCapabilitiesKnowledge({ directory: "c:/matters/acme/" });
      const first = await modelContext(parent);
      expect(first.reminder).toStartWith('<system-reminder topic="project-prompt">');
      expect(first.reminder).toContain("Parent writing style");
      expect(first.system).not.toContain("Parent writing style");
      // An edit reaches existing chats with the next message; the system prompt stays the same.
      parentStyle = "Edited writing style";
      const edited = await modelContext(parent);
      expect(edited.reminder).toContain("Edited writing style");
      expect(edited.system).toBe(first.system);
      // A server that cannot answer is no change, not a removed prompt.
      parentStyle = null;
      expect((await modelContext(parent)).reminder).toBe("");
      parentStyle = "";
      expect((await modelContext(parent)).reminder).toContain("project personalisation was removed");

      const nested = await prompt("c:/MATTERS/Acme/Contracts/documents");
      expect(nested).toContain("Nested writing style");
      expect(nested).not.toContain("Parent writing style");
      expect(await prompt("C:\\Matters\\Acme-other")).toBe("");
      expect(requestCount).toBeGreaterThan(0);
    } finally {
      server.stop(true);
      if (previousUrl === undefined) delete process.env.LEGALWORK_SERVER_URL;
      else process.env.LEGALWORK_SERVER_URL = previousUrl;
      if (previousToken === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN;
      else process.env.LEGALWORK_WIKI_AGENT_TOKEN = previousToken;
    }
  });
});
