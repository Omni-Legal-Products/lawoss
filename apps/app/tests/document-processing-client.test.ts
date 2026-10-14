import { expect, test } from "bun:test";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";

test("native document client sends exact selected runtime scope and prepare/read/cancel/export/validate bodies", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const server = Bun.serve({ port: 0, fetch: async request => {
    const url = new URL(request.url);
    expect(request.headers.get("authorization")).toBe("Bearer selected-token");
    expect(url.pathname).toStartWith("/workspace/runtime%20selected/lawoss/documents");
    const body = request.method === "POST" ? await request.json() : null;
    calls.push({ path: url.pathname + url.search, method: request.method, body });
    if (request.method === "DELETE") return Response.json({ id: "root selected", cancelled: true });
    if (url.pathname.endsWith("/read")) return Response.json({ id: "root selected", nextOffset: null, untrusted: true });
    if (url.pathname.endsWith("/export")) return Response.json({ path: "output.csv", verified: false, legalApproval: false });
    if (url.pathname.endsWith("/validate")) return Response.json({ valid: false, issues: [{ code: "coverage", message: "fixture incomplete source" }], outputs: [], legalApproval: false, instruction: "repair" });
    if (url.pathname.endsWith("/outputs")) return Response.json({ outputs: [], nextOffset: null, legalApproval: false });
    return Response.json({ documents: [], nextOffset: null, untrusted: true });
  } });
  try {
    const client = createLegalworkServerClient({ baseUrl: `http://127.0.0.1:${server.port}`, token: "selected-token" });
    await client.prepareLawossDocuments("runtime selected", ["explicit/a.pdf"]);
    await client.listLawossDocuments("runtime selected", 50, 50);
    await client.readLawossDocument("runtime selected", "root selected", 16000, 16000);
    await client.cancelLawossDocument("runtime selected", "root selected");
    const output = { path: "output.csv", kind: "registry" as const, outputLanguage: "cs" as const, documentIds: ["root selected"], entries: [] };
    expect((await client.exportLawossDocument("runtime selected", output)).verified).toBe(false);
    const validation = { paths: ["output.csv"], documentIds: ["root selected"], outputLanguage: "cs" as const };
    expect((await client.validateLawossDocuments("runtime selected", validation)).valid).toBe(false);
    await client.listLawossOutputs("runtime selected", 20, 20);
    expect(calls.map(call => [call.method, call.path])).toEqual([
      ["POST", "/workspace/runtime%20selected/lawoss/documents/prepare"],
      ["GET", "/workspace/runtime%20selected/lawoss/documents?offset=50&limit=50"],
      ["GET", "/workspace/runtime%20selected/lawoss/documents/root%20selected/read?offset=16000&limit=16000"],
      ["DELETE", "/workspace/runtime%20selected/lawoss/documents/root%20selected"],
      ["POST", "/workspace/runtime%20selected/lawoss/documents/export"],
      ["POST", "/workspace/runtime%20selected/lawoss/documents/validate"],
      ["GET", "/workspace/runtime%20selected/lawoss/documents/outputs?offset=20&limit=20"],
    ]);
    expect(calls[0].body).toEqual({ paths: ["explicit/a.pdf"] });
    expect(calls[4].body).toEqual(output); expect(calls[5].body).toEqual(validation);
  } finally { server.stop(true); }
});
