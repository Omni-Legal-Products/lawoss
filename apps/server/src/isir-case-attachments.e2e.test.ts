import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadISIRCorpus, sha256 } from "../../../lawoss/testing/isir/corpus.mjs";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

async function fixture(readOnly = false, registered = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-isir-attachment-")));
  cleanup.push(() => removeTestDir(root));
  const env = ["LEGALWORK_TOKEN_STORE", "LEGALWORK_RUNTIME_DB", "LEGALWORK_DATA_DIR"];
  const previous = env.map(key => process.env[key]);
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.LEGALWORK_DATA_DIR = join(root, "runtime");
  cleanup.push(async () => { env.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
  }); });
  const corpus = await loadISIRCorpus();
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "isir-client-test", hostToken: "isir-host-test",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    authorizedRoots: [root], readOnly, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false,
    workspaces: [],
  };
  for (const entry of corpus.cases) {
    const path = join(root, "Spisy", entry.id);
    await mkdir(path, { recursive: true });
    if (registered) config.workspaces.push({ id: entry.id, path, name: `ISIR test ${entry.id}`, preset: "starter", workspaceType: "local" });
  }
  const server = await startServer(config);
  cleanup.push(async () => { await server.stop(); });
  const base = `http://127.0.0.1:${server.port}`;
  const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
  const raw = (id: string, path: string) => `${base}/workspace/${id}/files/raw?path=${encodeURIComponent(path)}`;
  const upload = (id: string, path: string, bytes: Uint8Array, authenticated = true) => fetch(`${base}/workspace/${id}/files/raw`, {
    method: "POST", headers: authenticated ? headers : { "Content-Type": "application/json" },
    body: JSON.stringify({ path, dataBase64: Buffer.from(bytes).toString("base64") }),
  });
  return { root, config, corpus, headers, raw, upload, base };
}

describe("ISIR case attachment acceptance", () => {
  test("ten existing case folders register and persist without rewriting their files", async () => {
    const f = await fixture(false, false);
    for (const entry of f.corpus.cases) {
      const folderPath = join(f.root, "Spisy", entry.id), document = entry.documents[0]!;
      const path = "originál.pdf";
      await writeFile(join(folderPath, path), document.bytes);
      const response = await fetch(`${f.base}/workspaces/local`, {
        method: "POST", headers: { ...f.headers, "X-LegalWork-Host-Token": f.config.hostToken },
        body: JSON.stringify({ name: `ISIR test ${entry.id}`, folderPath, registerExisting: true }),
      });
      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.persisted).toBe(true);
      const downloaded = await fetch(f.raw(result.activeId, path), { headers: f.headers });
      expect(downloaded.status).toBe(200);
      expect(sha256(new Uint8Array(await downloaded.arrayBuffer()))).toBe(sha256(document.bytes));
    }
    const persisted = JSON.parse(await readFile(f.config.configPath!, "utf8"));
    expect(persisted.workspaces).toHaveLength(10);
    expect(new Set(persisted.workspaces.map((workspace: { path: string }) => workspace.path)).size).toBe(10);
  }, 60_000);

  test("twenty original PDFs upload, list and download from ten distinct case folders", async () => {
    const f = await fixture();
    expect(f.corpus.cases).toHaveLength(10);
    for (const entry of f.corpus.cases) {
      for (const document of entry.documents) {
        const path = `Přílohy/ISIR/${document.name}`;
        const originalHash = sha256(document.bytes);
        const response = await f.upload(entry.id, path, document.bytes);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, path, bytes: document.bytes.length });
        expect(sha256(await readFile(join(f.root, "Spisy", entry.id, path)))).toBe(originalHash);
        const download = await fetch(f.raw(entry.id, path), { headers: f.headers });
        expect(download.status).toBe(200);
        expect(download.headers.get("content-type")).toContain("application/pdf");
        expect(sha256(new Uint8Array(await download.arrayBuffer()))).toBe(originalHash);
        if (document.sourcePath) expect(sha256(await readFile(document.sourcePath))).toBe(originalHash);
      }
      const list = await fetch(`${f.base}/workspace/${entry.id}/files/list?path=${encodeURIComponent("Přílohy/ISIR")}`, { headers: f.headers });
      expect(list.status).toBe(200);
      expect((await list.json()).entries.map((entry: { name: string }) => entry.name).sort()).toEqual(entry.documents.map(document => document.name).sort());
    }
  }, 60_000);

  test("switching cases keeps same-named files and their contents separate", async () => {
    const f = await fixture();
    for (const entry of f.corpus.cases) {
      const bytes = Buffer.from(JSON.stringify({ caseId: entry.id }));
      expect((await f.upload(entry.id, "Přílohy/metadata.json", bytes)).status).toBe(200);
    }
    for (const entry of [...f.corpus.cases].reverse()) {
      const response = await fetch(f.raw(entry.id, "Přílohy/metadata.json"), { headers: f.headers });
      expect(await response.json()).toEqual({ caseId: entry.id });
    }
    const response = await f.upload("unknown-case", "Přílohy/metadata.json", Buffer.from("wrong"));
    expect(response.status).toBe(404);
  });

  test("an unavailable case folder fails explicitly and is never silently recreated", async () => {
    const f = await fixture();
    const entry = f.corpus.cases[0]!;
    const source = join(f.root, "Spisy", entry.id), moved = `${source}-disconnected`;
    await rename(source, moved);
    const response = await f.upload(entry.id, "Přílohy/test.pdf", entry.documents[0]!.bytes);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "project_folder_unavailable" });
    expect(await stat(source).catch(() => null)).toBeNull();
    const other = f.corpus.cases[1]!;
    expect((await f.upload(other.id, "Přílohy/test.pdf", other.documents[0]!.bytes)).status).toBe(200);
    await rename(moved, source);
  });

  test("rejected uploads preserve existing documents and do not create a sibling case file", async () => {
    const f = await fixture();
    const entry = f.corpus.cases[0]!, bytes = entry.documents[0]!.bytes;
    const path = "Přílohy/original.pdf";
    expect((await f.upload(entry.id, path, bytes)).status).toBe(200);
    expect((await f.upload(entry.id, path, Buffer.from("unauthorized"), false)).status).toBe(401);
    const escaped = await f.upload(entry.id, "../case-02/escape.pdf", bytes);
    expect([400, 403]).toContain(escaped.status);
    expect(await stat(join(f.root, "Spisy", "case-02", "escape.pdf")).catch(() => null)).toBeNull();
    expect(sha256(await readFile(join(f.root, "Spisy", entry.id, path)))).toBe(sha256(bytes));
  });

  test("read-only cases reject an attachment without changing the case folder", async () => {
    const f = await fixture(true), entry = f.corpus.cases[0]!;
    expect((await f.upload(entry.id, "Přílohy/test.pdf", entry.documents[0]!.bytes)).status).toBe(403);
    expect(await stat(join(f.root, "Spisy", entry.id, "Přílohy")).catch(() => null)).toBeNull();
  });
});
