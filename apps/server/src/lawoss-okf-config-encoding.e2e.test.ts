// LAWOSS: okf.config z Windows (Poznámkový blok, PowerShell 5.1) číta appka cez server rovnako ako CLI OKF.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeText } from "./lawoss/workspace-text.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => removeTestDir(root))); });

const CONFIG = 'matter_folders: ["Podklady", "Návrhy"]\r\nfolder_roles:\r\n  drafts: Návrhy\r\nclient_path: Klienti/*\r\n';
const ENCODINGS: Record<string, (text: string) => Buffer> = {
  "UTF-8 with BOM": (text) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]),
  "UTF-16LE with BOM": (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
  "UTF-16BE with BOM": (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]).swap16(),
};

async function serve() {
  // Natívny realpath: %TEMP% na windows-2022 obsahuje krátke meno 8.3 (RUNNER~1).
  const root = await realpath(await mkdtemp(join(tmpdir(), "okf-config-encoding-")));
  roots.push(root);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test-okf-encoding-client", hostToken: "test-okf-encoding-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config) as { port: number; stop(closeActiveConnections?: boolean): void | Promise<void> };
  const url = `http://127.0.0.1:${server.port}/workspace/ws_1/files/content`;
  const headers = { Authorization: `Bearer ${config.token}` };
  return {
    root, stop: () => server.stop(true),
    read: async (path: string) => (await fetch(`${url}?path=${encodeURIComponent(path)}`, { headers })).json() as Promise<{ content: string }>,
    save: (path: string, content: string, expectedContent: string | null) => fetch(url, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path, content, expectedContent }),
    }),
  };
}

test("decodeText: UTF-16 LE/BE a UTF-8 len podľa BOM, BOM sa odstráni", () => {
  for (const encode of Object.values(ENCODINGS)) expect(decodeText(encode(CONFIG))).toBe(CONFIG);
  expect(decodeText(Buffer.from(CONFIG, "utf8"))).toBe(CONFIG);
  expect(decodeText(Buffer.from("n\xe1vrh", "latin1"))).toBe("n�vrh");
});

for (const [name, encode] of Object.entries(ENCODINGS)) {
  test(`okf.config v ${name}: appka dostane text ako CLI a uloženie s ním nie je konflikt`, async () => {
    const server = await serve();
    try {
      await mkdir(join(server.root, "Office"));
      await writeFile(join(server.root, "Office", "okf.config"), encode(CONFIG));
      const { content } = await server.read("Office/okf.config");
      expect(content).toBe(CONFIG);
      const next = CONFIG.replace("Klienti/*", "Klienti/*/*");
      expect((await server.save("Office/okf.config", next, content)).status).toBe(200);
      // Editor zapíše UTF-8 bez BOM; CLI aj appka ho potom čítajú zhodne.
      expect(await readFile(join(server.root, "Office", "okf.config"), "utf8")).toBe(next);
    } finally { await server.stop(); }
  });
}

test("iné súbory ostávajú UTF-8 ako v upstreame: BOM v Markdowne zostane", async () => {
  const server = await serve();
  try {
    await writeFile(join(server.root, "poznamka.md"), ENCODINGS["UTF-8 with BOM"]!("# Poznámka\n"));
    expect((await server.read("poznamka.md")).content).toBe("﻿# Poznámka\n");
  } finally { await server.stop(); }
});
