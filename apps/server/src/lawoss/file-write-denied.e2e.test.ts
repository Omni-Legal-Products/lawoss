import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError, fileWriteError } from "../errors.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function serveReadOnlyClientFolder() {
  const root = await mkdtemp(join(tmpdir(), "lawoss-545-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "Spisy");
  await mkdir(folder);
  await writeFile(join(folder, "Stanovisko.docx"), "pôvodný obsah");
  await writeFile(join(folder, "Poznamka.md"), "pôvodná poznámka");
  await chmod(folder, 0o555);
  cleanups.push(() => chmod(folder, 0o755));
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Klient", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  cleanups.push(() => server.stop(true));
  const post = (route: string, body: Record<string, unknown>) => fetch(`http://127.0.0.1:${server.port}/workspace/ws_1/files/${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { folder, post };
}

describe("#545 zápis do priečinka bez práva zápisu", () => {
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("files/raw vráti 403 file_not_writable a súbor ostane nezmenený", async () => {
    const { folder, post } = await serveReadOnlyClientFolder();
    const response = await post("raw", { path: "Spisy/Stanovisko.docx", dataBase64: Buffer.from("nový obsah").toString("base64"), force: true });
    expect({ status: response.status, code: (await response.json()).code }).toEqual({ status: 403, code: "file_not_writable" });
    expect(await readFile(join(folder, "Stanovisko.docx"), "utf8")).toBe("pôvodný obsah");
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("files/content vráti 403 file_not_writable", async () => {
    const { post } = await serveReadOnlyClientFolder();
    const response = await post("content", { path: "Spisy/Poznamka.md", content: "nová poznámka", force: true });
    expect({ status: response.status, code: (await response.json()).code }).toEqual({ status: 403, code: "file_not_writable" });
  });

  test("plný disk je 507 disk_full a iné chyby ostanú nezmenené", () => {
    const full = Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    const mapped = fileWriteError(full);
    expect(mapped instanceof ApiError ? [mapped.status, mapped.code] : mapped).toEqual([507, "disk_full"]);
    const other = Object.assign(new Error("EIO"), { code: "EIO" });
    expect(fileWriteError(other)).toBe(other);
  });
});
