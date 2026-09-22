import { isAbsolute } from "node:path";
import { checkedDirectory, contained, isObject } from "../okf-pamat/src/workspace-memory-fs.ts";

const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1024;

/** Live host authority only. Never consult profile, environment grants or persisted bindings. */
export async function resolveHostMemoryGrants({ directory, serverUrl, token, fetch: fetcher = globalThis.fetch, timeoutMs = 5000 }) {
  const failure = () => new Error("Host memory permissions unavailable; verify this workspace's native folder permissions.");
  if (!serverUrl || typeof token !== "string" || !token.trim()) throw failure();
  let base;
  try {
    base = new URL(serverUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw failure();
  } catch { throw failure(); }
  const controller = new AbortController(); let timer;
  const run = async () => {
    const root = checkedDirectory(directory);
    async function get(path) {
      const response = await fetcher(`${base.href.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal, redirect: "error" });
      if (!response.ok || !response.body) throw failure();
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength; if (size > MAX_BYTES) throw failure(); chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    }
    const workspaces = await get("/workspaces");
    if (!isObject(workspaces) || !Array.isArray(workspaces.items) || workspaces.items.length > MAX_ENTRIES) throw failure();
    const candidates = [], ids = new Set();
    for (const workspace of workspaces.items) {
      if (!isObject(workspace) || typeof workspace.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(workspace.id) || ids.has(workspace.id) || typeof workspace.path !== "string") throw failure();
      ids.add(workspace.id);
      if (workspace.workspaceType !== undefined && workspace.workspaceType !== "local" && workspace.workspaceType !== "remote") throw failure();
      if (workspace.workspaceType === "remote") continue;
      if (!isAbsolute(workspace.path)) throw failure();
      // A stale unrelated registration must not prevent loading a different local matter.
      let canonical;
      try { canonical = checkedDirectory(workspace.path); } catch { if (contained(workspace.path, root)) throw failure(); continue; }
      if (contained(canonical, root)) candidates.push({ id: workspace.id, root: canonical });
    }
    candidates.sort((a, b) => b.root.length - a.root.length);
    const selected = candidates[0];
    if (!selected || candidates[1]?.root === selected.root) throw failure();
    const grants = await get(`/workspace/${encodeURIComponent(selected.id)}/lawoss/memory/grants`);
    if (!isObject(grants) || grants.authority !== "runtime" || grants.workspaceId !== selected.id || typeof grants.workspaceRoot !== "string" || checkedDirectory(grants.workspaceRoot) !== selected.root || !Array.isArray(grants.folders) || grants.folders.length > MAX_ENTRIES || !Number.isSafeInteger(grants.hiddenCount) || grants.hiddenCount < 0) throw failure();
    if (grants.folders.some(folder => typeof folder !== "string" || !isAbsolute(folder) || folder.includes("\0"))) throw failure();
    if (grants.hiddenCount > 0) return [];
    return [...new Set(grants.folders.map(folder => checkedDirectory(folder)))].sort();
  };
  try {
    return await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure()); }, Math.min(Math.max(timeoutMs, 1), 5000)); })]);
  } catch { throw failure(); }
  finally { clearTimeout(timer); controller.abort(); }
}
