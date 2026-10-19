import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VmSandbox } from "../../agent-sandbox/vm.js";
import { ProtectedVmEngine } from "./vm-engine.js";

const enabled = process.env.LAWOSS_PROTECTED_VM_TEST === "1";

// This independent CLI substitutes only the engine. The actual guest launcher,
// private HTTP, VM and host RPC run unchanged; it proves readiness ordering,
// never real-engine inference, document processing or legal/provider approval.
const fixtureEngine = `#!/usr/local/bin/node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('/authorized/0/fixture.json', 'utf8'));
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const directory = process.cwd();
const completed = [];
const authorization = 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
const names = ['lawoss_documents_list', 'lawoss_documents_read', 'lawoss_documents_export', 'lawoss_documents_validate'];
const argumentsByTool = {
  lawoss_documents_list: ['offset', 'limit'],
  lawoss_documents_read: ['id', 'offset', 'limit'],
  lawoss_documents_export: ['path', 'kind', 'outputLanguage', 'documentIds', 'expectedHash', 'entries'],
  lawoss_documents_validate: ['paths', 'documentIds', 'outputLanguage'],
};
const server = createServer((request, response) => {
  if (request.headers.authorization !== authorization) { response.writeHead(401); response.end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/global/health') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ healthy: true, version: '1.18.29' })); return; }
  if (url.pathname === '/path') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ directory, completed })); return; }
  if (request.method !== 'GET' || url.searchParams.get('directory') !== directory) { response.writeHead(400); response.end(); return; }
  let payload;
  if (url.pathname === '/provider') payload = { all: [{ id: 'protected-documents', models: { synthetic: { id: fixture.mode === 'wrong-model' ? 'different-model' : 'synthetic', providerID: 'protected-documents' } } }], default: { 'protected-documents': 'synthetic' }, connected: ['protected-documents'] };
  if (url.pathname === '/agent') payload = [{ name: 'legalwork', mode: 'primary', description: 'Synthetic readiness fixture' }];
  if (url.pathname === '/experimental/tool' && url.searchParams.get('provider') === 'protected-documents' && url.searchParams.get('model') === 'synthetic') payload = names.map(id => ({ id, description: 'Synthetic readiness fixture', parameters: { type: 'object', properties: Object.fromEntries(argumentsByTool[id].map(name => [name, {}])) } }));
  if (Array.isArray(payload) && url.pathname === '/experimental/tool' && fixture.mode === 'missing-tool-schema') delete payload.find(tool => tool.id === 'lawoss_documents_validate').parameters.properties.paths;
  if (!payload) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.write(' ');
  // Headers alone are insufficient. /path records only completed bodies and
  // therefore exposes early publication through the returned public SDK API.
  setTimeout(() => { completed.push(url.pathname); response.end(JSON.stringify(payload)); }, 60);
});
server.listen(port, '127.0.0.1');
`;

for (const mode of ["ready", "wrong-model", "missing-tool-schema"]) {
(enabled ? test : test.skip)(`public VM open checks complete confined readiness before accepting SDK work (${mode})`, async () => {
  const runtimeDirectory = process.env.LAWOSS_PROTECTED_VM_TEST_RUNTIME;
  if (!runtimeDirectory) throw new Error("An explicitly selected protected VM runtime is required");
  const root = await mkdtemp(join(tmpdir(), "lawoss-protected-readiness-"));
  const bundleDirectory = join(root, "bundle"), emptyDirectory = join(root, "empty");
  let engine: ProtectedVmEngine | undefined;
  let modelCalls = 0, toolCalls = 0;
  try {
    await Promise.all([mkdir(bundleDirectory), mkdir(emptyDirectory)]);
    await copyFile(new URL("../../../resources/agent-sandbox/protected-engine.mjs", import.meta.url), join(bundleDirectory, "protected-engine.mjs"));
    await writeFile(join(bundleDirectory, "opencode"), fixtureEngine);
    await chmod(join(bundleDirectory, "opencode"), 0o500);
    await writeFile(join(bundleDirectory, "plugin.mjs"), "export default async () => ({ tool: {} });\n");
    await writeFile(join(bundleDirectory, "fixture.json"), JSON.stringify({ mode }));
    await writeFile(join(bundleDirectory, "config.json"), JSON.stringify({ model: { id: "synthetic", context: 100000, output: 4000 } }));
    const opening = ProtectedVmEngine.open({ bundleDirectory, emptyDirectory, signal: AbortSignal.timeout(150_000),
      handleOutbound: async () => { modelCalls++; throw new Error("Readiness must not request a model"); },
      handleTool: async () => { toolCalls++; throw new Error("Readiness must not execute a document tool"); },
    }, { createSandbox: broker => new VmSandbox(runtimeDirectory, "auto", { request: broker, maxRequests: 4096 }) });
    if (mode !== "ready") {
      await expect(opening).rejects.toThrow("phase engine-initialization");
      await expect(opening).rejects.toThrow(`initialization ${mode === "wrong-model" ? "provider-invalid" : "tool-schema-invalid"}`);
      expect(modelCalls).toBe(0);
      expect(toolCalls).toBe(0);
      return;
    }
    engine = await opening;
    const response = await engine.fetch(new Request("http://private-engine/path", { signal: AbortSignal.timeout(5000) }));
    expect(response.status).toBe(200);
    const proof: { directory: string; completed: string[] } = await response.json();
    expect({ ...proof, completed: [...proof.completed].sort() }).toEqual({ directory: "/tmp/home/protected-engine/workspace", completed: ["/provider", "/agent", "/experimental/tool"].sort() });
    expect(modelCalls).toBe(0);
    expect(toolCalls).toBe(0);
  } finally {
    try { await engine?.stop(); }
    finally { try { await VmSandbox.shutdown(); } finally { await rm(root, { recursive: true, force: true }); } }
  }
}, 180_000);
}
