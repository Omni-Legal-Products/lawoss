import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { checkedDirectory, checkedPath, contained, isObject } from "../okf-pamat/src/workspace-memory-fs.ts";

const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1024;
const failure = () => new Error("Host memory permissions unavailable; verify this workspace's native folder permissions.");

function hostBase(serverUrl, token) {
  if (!serverUrl || typeof token !== "string" || !token.trim()) throw failure();
  try {
    const base = new URL(serverUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw failure();
    return base.href.replace(/\/$/, "");
  } catch { throw failure(); }
}

async function boundedJson(fetcher, base, token, signal, path) {
  const response = await fetcher(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, signal, redirect: "error" });
  if (!response.ok || !response.body || response.redirected) throw failure();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw failure();
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw failure(); }
}

function selectWorkspace(directory, workspaces) {
  const root = checkedDirectory(directory);
  if (!isObject(workspaces) || !Array.isArray(workspaces.items) || workspaces.items.length > MAX_ENTRIES) throw failure();
  const ids = new Set(), candidates = [];
  for (const workspace of workspaces.items) {
    if (!isObject(workspace) || typeof workspace.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(workspace.id) || ids.has(workspace.id) || typeof workspace.path !== "string") throw failure();
    ids.add(workspace.id);
    if (workspace.workspaceType !== undefined && workspace.workspaceType !== "local" && workspace.workspaceType !== "remote") throw failure();
    if (workspace.workspaceType === "remote") continue;
    if (!isAbsolute(workspace.path)) throw failure();
    let canonical;
    try { canonical = checkedDirectory(workspace.path); }
    catch { if (contained(workspace.path, root)) throw failure(); continue; }
    if (contained(canonical, root)) candidates.push({ id: workspace.id, root: canonical });
  }
  candidates.sort((a, b) => b.root.length - a.root.length);
  if (!candidates[0] || candidates[1]?.root === candidates[0].root) throw failure();
  return candidates[0];
}

function validatedFolders(value, selected) {
  if (!isObject(value) || value.authority !== "runtime" || value.workspaceId !== selected.id || typeof value.workspaceRoot !== "string" || checkedDirectory(value.workspaceRoot) !== selected.root || !Array.isArray(value.folders) || value.folders.length > MAX_ENTRIES || !Number.isSafeInteger(value.hiddenCount) || value.hiddenCount < 0) throw failure();
  if (value.folders.some(folder => typeof folder !== "string" || !isAbsolute(folder) || folder.includes("\0"))) throw failure();
  return value.hiddenCount > 0 ? [] : [...new Set(value.folders.map(folder => checkedDirectory(folder)))].sort();
}

async function withHost({ directory, serverUrl, token, fetch: fetcher = globalThis.fetch, timeoutMs = 5000 }, operation) {
  const base = hostBase(serverUrl, token), controller = new AbortController();
  let timer;
  const run = async () => {
    const get = path => boundedJson(fetcher, base, token, controller.signal, path);
    const selected = selectWorkspace(directory, await get("/workspaces"));
    const grants = await get(`/workspace/${encodeURIComponent(selected.id)}/lawoss/memory/grants`);
    const folders = validatedFolders(grants, selected);
    return operation({ get, selected, grants, folders });
  };
  try {
    return await Promise.race([run(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure()); }, Math.min(Math.max(timeoutMs, 1), 5000));
    })]);
  } catch { throw failure(); }
  finally { clearTimeout(timer); controller.abort(); }
}

/** Live host authority only. Never consult profile, environment grants or persisted bindings. */
export async function resolveHostMemoryGrants(options) {
  return withHost(options, ({ folders }) => folders);
}

function canonicalProfile(profile) {
  if (!isObject(profile) || typeof profile.profilePath !== "string" || !isAbsolute(profile.profilePath) || profile.profilePath.includes("\0") || typeof profile.profileIdentity !== "string" || !Array.isArray(profile.profileGrants) || profile.profileGrants.length > MAX_ENTRIES) throw failure();
  checkedPath(profile.profilePath, "file");
  const profilePath = realpathSync(profile.profilePath);
  if (profile.profileIdentity !== profilePath) throw failure();
  const profileGrants = [...new Set(profile.profileGrants.map(grant => {
    if (typeof grant !== "string" || !isAbsolute(grant) || grant.includes("\0")) throw failure();
    return checkedDirectory(grant);
  }))].sort();
  if (!profileGrants.some(grant => contained(grant, profilePath))) throw failure();
  return { profilePath, profileIdentity: profilePath, profileGrants };
}

/** Host-selected map-mode paths. The client directory never supplies these values. */
export async function resolveHostMemoryContext(options) {
  return withHost(options, async ({ get, selected, folders }) => {
    const context = await get(`/workspace/${encodeURIComponent(selected.id)}/lawoss/memory/context`);
    if (!isObject(context) || context.authority !== "runtime" || context.workspaceId !== selected.id || typeof context.workspaceRoot !== "string" || checkedDirectory(context.workspaceRoot) !== selected.root || !Array.isArray(context.folders) || context.folders.length > MAX_ENTRIES || !Number.isSafeInteger(context.hiddenCount) || context.hiddenCount < 0) throw failure();
    if (context.folders.some(folder => typeof folder !== "string" || !isAbsolute(folder) || folder.includes("\0"))) throw failure();
    const contextFolders = context.hiddenCount > 0 ? [] : [...new Set(context.folders.map(folder => checkedDirectory(folder)))].sort();
    if (JSON.stringify(contextFolders) !== JSON.stringify(folders)) throw failure();
    let handoffRoot;
    if (context.handoffRoot !== undefined) {
      if (typeof context.handoffRoot !== "string" || !isAbsolute(context.handoffRoot) || context.handoffRoot.includes("\0")) throw failure();
      handoffRoot = checkedDirectory(context.handoffRoot);
      if (contained(selected.root, handoffRoot)) throw failure();
    }
    if (context.profile !== undefined && !isObject(context.profile)) throw failure();
    if (handoffRoot && context.profile === undefined) throw failure();
    const profile = context.profile === undefined ? {} : canonicalProfile(context.profile);
    if (handoffRoot && contained(selected.root, profile.profilePath)) throw failure();
    return { allowedRoots: [selected.root, ...folders.filter(folder => folder !== selected.root)], ...profile, ...(handoffRoot ? { handoffRoot } : {}) };
  });
}
