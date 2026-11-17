/**
 * #494: priečinok klienta zmizne počas behu a vráti sa. Stav enginu nesie kód `project_folder_unavailable` (appka
 * podľa neho ukáže preložený text bez „OpenCode“) a po návrate priečinka server nič nedrží: Domov projektu, súbory,
 * aktivácia aj stav enginu sú hneď znova v poriadku, bez reštartu.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";

const cleanups: Array<() => unknown> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

test("chýbajúci priečinok: kód v stave enginu; po návrate priečinka všetko hneď funguje", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-494-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "C024-syn"), away = join(root, "presunute");
  await mkdir(folder);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "owt_test_token", hostToken: "owt_host_token", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const headers = { "X-LegalWork-Host-Token": "owt_host_token", Authorization: "Bearer owt_test_token", "Content-Type": "application/json" };
  const created = await fetch(`${base}/workspaces/local`, { method: "POST", headers, body: JSON.stringify({ folderPath: folder, name: "SYN Tomáš" }) });
  const { activeId } = await created.json();
  const statuses = async () => Promise.all([
    fetch(`${base}/workspace/${activeId}/project`, { headers }),
    fetch(`${base}/workspace/${activeId}/files/list?path=`, { headers }),
    fetch(`${base}/workspaces/${activeId}/activate`, { method: "POST", headers }),
  ].map(async (pending) => (await pending).status));

  await rename(folder, away);
  expect(await statuses()).toEqual([404, 404, 404]);
  const engine = await (await fetch(`${base}/workspace/${activeId}/engine-project`, { headers })).json();
  expect(engine.state).toBe("configuration_conflict");
  expect(engine.projection.code).toBe("project_folder_unavailable");

  await rename(away, folder);
  expect(await statuses()).toEqual([200, 200, 200]);
  const restored = await (await fetch(`${base}/workspace/${activeId}/engine-project`, { headers })).json();
  expect(restored.state).toBe("ready");
  expect(restored.projection.code).toBeUndefined();
});
