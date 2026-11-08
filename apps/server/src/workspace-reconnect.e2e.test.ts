import { afterEach, expect, test } from "bun:test";
import { enforceAiBoundaries } from "./lawoss/test-support/ai-boundaries.js";
import { mkdtemp, mkdir, rename, readFile, writeFile, rm, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeSyntheticTestDir } from "./lawoss/test-support/inspect-cleanup.js";
import { startServer } from "./server.js";
import { buildWorkspaceInfos } from "./workspaces.js";
import type { ServerConfig } from "./types.js";
import { nativeRow } from "./lawoss/test-support/native-config.js";
import { fakeEngineV2, startRealEngineV2 } from "./lawoss/test-support/fake-engine-v2.js";
import { OpenCode } from "@opencode/client";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });
// Windows refuses renaming A while anything holds a descendant open; content created after
// the server started can still be open when the test renames A. Prepare it before the start.
async function fixture(prepare?: (a: string, root: string) => Promise<unknown>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "reconnect-")));
  cleanup.push(() => removeSyntheticTestDir(root));
  const a = join(root, "A"), b = join(root, "B");
  await mkdir(a); await writeFile(join(a, "source.pdf"), "%PDF-original"); await prepare?.(a, root);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [{id: "stable", name: "Matter", displayName: "Matter", path: a, preset: "starter", workspaceType: "local", appFiles: "outside"}], authorizedRoots: [a], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); cleanup.push(() => Promise.resolve(server.stop()));
  const request = (folderPath = b, expectedPath = a, authorized = true) => fetch(`http://127.0.0.1:${server.port}/workspace/stable/reconnect`, { method: "POST", headers: { "Content-Type": "application/json", ...(authorized ? { "X-LegalWork-Host-Token": "host" } : { Authorization: "Bearer client" }) }, body: JSON.stringify({ folderPath, expectedPath }) });
  return { root, a, b, config, server, request };
}
test("moved folder reconnect preserves ID, metadata, bytes and restart registry", async () => {
  const f = await fixture(); await rename(f.a, f.b);
  const unavailable = await fetch(`http://127.0.0.1:${f.server.port}/workspace/stable/project`, { headers: { Authorization: "Bearer client" } });
  expect((await unavailable.json()).code).toBe("project_folder_unavailable");
  const response = await f.request(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ workspace: { id: "stable", path: f.b, appFiles: "outside", displayName: "Matter" }, persisted: true });
  expect(await readFile(join(f.b, "source.pdf"), "utf8")).toBe("%PDF-original");
  const persisted = JSON.parse(await readFile(f.config.configPath!, "utf8"));
  expect(buildWorkspaceInfos(persisted.workspaces, f.root)[0]?.id).toBe("stable"); expect(persisted.authorizedRoots).toEqual([f.b]);
  const restarted = await startServer({ ...f.config, port: 0, workspaces: buildWorkspaceInfos(persisted.workspaces, f.root), authorizedRoots: persisted.authorizedRoots });
  cleanup.push(() => Promise.resolve(restarted.stop()));
  const pdf = await fetch(`http://127.0.0.1:${restarted.port}/workspace/stable/files/raw?path=source.pdf`, { headers: { Authorization: "Bearer client" } });
  expect(pdf.status).toBe(200); expect(await pdf.text()).toBe("%PDF-original");
});
test("invalid authorization, stale, intact, missing and registered targets cannot change registry", async () => {
  const f = await fixture(); await mkdir(f.b); const before = JSON.stringify(f.config.workspaces);
  for (const response of [await f.request(f.b, f.a, false), await f.request(f.b, "stale"), await f.request(), await f.request(join(f.root, "absent"))]) expect(response.ok).toBe(false);
  expect(JSON.stringify(f.config.workspaces)).toBe(before);
  await rename(f.a, join(f.root, "moved")); f.config.workspaces.push({ id: "other", path: f.b, name: "Other", preset: "starter", workspaceType: "local" });
  expect((await f.request()).ok).toBe(false); expect(f.config.workspaces[0]?.path).toBe(f.a);
});
test("persistence failure rolls back and simultaneous reconnect has one winner", async () => {
  const f = await fixture(); await rename(f.a, f.b); f.config.configPath = f.root;
  expect((await f.request()).ok).toBe(false); expect(f.config.workspaces[0]?.path).toBe(f.a); expect(f.config.authorizedRoots).toEqual([f.a]);
  f.config.configPath = join(f.root, "server.json"); const results = await Promise.all([f.request(), f.request()]); expect(results.filter(r => r.ok)).toHaveLength(1);
});

test("historical chats and artifact paths remain bound to same ID without authorizing old files", async () => {
  const f = await fixture();
  // LAWOSS v2: the engine moves a captured chat to the reconnected folder (`session.move`).
  const engine = fakeEngineV2({ sessions: [{ id: "chat-original", title: "Original", directory: f.a, created: 1, updated: 1 }] }); cleanup.push(async () => engine.stop());
  f.config.opencodeBaseUrl = engine.url;
  await rename(f.a, f.b); expect((await f.request()).ok).toBe(true);
  expect(engine.moves()).toEqual([{ sessionID: "chat-original", body: { directory: f.b } }]);
  const base = `http://127.0.0.1:${f.server.port}`;
  const sessions = await fetch(`${base}/workspace/stable/sessions`, { headers: { Authorization: "Bearer client" } });
  expect(sessions.status).toBe(200); expect(JSON.stringify(await sessions.json())).toContain("chat-original");
  const artifacts = await fetch(`${base}/workspace/stable/artifacts/resolve`, { method: "POST", headers: { Authorization: "Bearer client", "Content-Type": "application/json" }, body: JSON.stringify({ targets: [{ kind: "file", value: join(f.a, "source.pdf") }] }) });
  expect(await artifacts.json()).toMatchObject({ items: [{ value: "source.pdf", exists: true }] });
  expect(f.config.authorizedRoots).toEqual([f.b]);
});

test("desktop transaction rollback follows server persistence failure", async () => {
  const f = await fixture(); await rename(f.a, f.b);
  let desktopPath = f.a;
  f.config.reconnectHostWorkspace = async workspace => { const before = desktopPath; desktopPath = workspace.path; return async () => { desktopPath = before; }; };
  f.config.configPath = f.root;
  expect((await f.request()).ok).toBe(false); expect(desktopPath).toBe(f.a); expect(f.config.workspaces[0]?.path).toBe(f.a);
  f.config.reconnectHostWorkspace = async () => { throw new Error("Desktop persistence denied"); };
  f.config.configPath = join(f.root, "server.json");
  expect((await f.request()).ok).toBe(false); expect(f.config.workspaces[0]?.path).toBe(f.a);
});

test("outside app-files storage identity survives reconnect", async () => {
  const { externalAppFilesRoot } = await import("./lawoss/workspace-app-files.js");
  const f = await fixture(); const original = externalAppFilesRoot(f.config, f.config.workspaces[0]!);
  await mkdir(original, { recursive: true }); await writeFile(join(original, "memory-profile.json"), "host profile");
  await rename(f.a, f.b); expect((await f.request()).ok).toBe(true);
  expect(externalAppFilesRoot(f.config, f.config.workspaces[0]!)).toBe(original);
  expect(await readFile(join(original, "memory-profile.json"), "utf8")).toBe("host profile");
});

test("remote projects, files, aliases and foreign symlink targets cannot reconnect", async () => {
  const f = await fixture(); await rename(f.a, f.b);
  await writeFile(join(f.root, "not-dir"), "keep bytes");
  await symlink(f.b, join(f.root, "alias"));
  for (const target of [join(f.root, "not-dir"), join(f.root, "alias"), "relative/path"])
    expect((await f.request(target)).ok).toBe(false);
  // LAWOSS v2: upstream removed remote workspaces (workspaceType is always "local").
  expect(await readFile(join(f.b, "source.pdf"), "utf8")).toBe("%PDF-original");
});

test("with AI boundaries on, native mounted session list and getters exclude later foreign chats reusing old path", async () => {
  const f = await fixture(); await enforceAiBoundaries(f.config); f.config.workspaces[0]!.directory = f.a;
  const engine = fakeEngineV2({ sessions: [{ id: "original", title: "Original", directory: f.a, created: 1, updated: 1 }] }); cleanup.push(async () => engine.stop());
  f.config.opencodeBaseUrl = engine.url;
  await rename(f.a, f.b); expect((await f.request()).ok).toBe(true);
  // A later chat of someone else reuses the old path; it is not one of the captured chats.
  await mkdir(f.a); engine.create({ id: "foreign-late", title: "Foreign", directory: f.a });
  const base = `http://127.0.0.1:${f.server.port}/workspace/stable`;
  const headers = { Authorization: "Bearer client" };
  const list = await fetch(`${base}/opencode/session`, { headers });
  expect(list.status).toBe(200); expect((await list.json()).data.map((item: { id: string }) => item.id)).toEqual(["original"]);
  const ordinary = await fetch(`${base}/sessions`, { headers });
  expect(ordinary.status).toBe(200); expect((await ordinary.json()).items.map((item: { id: string }) => item.id)).toEqual(["original"]);
  expect((await fetch(`${base}/opencode/session/original`, { headers })).status).toBe(200);
  const shell = await fetch(`${base}/opencode/session/original/shell`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ command: "pwd" }) });
  expect(shell.status).toBe(403); expect(await shell.json()).toMatchObject({ code: "ai_transfer_denied" });
  expect(engine.requests.filter(request => request.path.endsWith("/shell"))).toEqual([]);
  // Supported session rebind remains verified above; protected tool execution is unavailable.
  expect((await fetch(`${base}/opencode/session/foreign-late/message`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/sessions/foreign-late/messages`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/opencode/experimental/session`, { headers })).status).toBe(403);
});

test.each(["derived", "custom"])("registering a freed path allocates distinct ID and storage for %s identity", async identity => {
  const { workspaceIdForPath } = await import("./workspaces.js");
  const f = await fixture(); const originalId = identity === "derived" ? workspaceIdForPath(f.a) : "stable"; f.config.workspaces[0]!.id = originalId;
  const engine = fakeEngineV2({ sessions: [{ id: "original-chat", title: "Original", directory: f.a, created: 1, updated: 1 }] }); cleanup.push(async () => engine.stop());
  f.config.opencodeBaseUrl = engine.url;
  await rename(f.a, f.b);
  const base = `http://127.0.0.1:${f.server.port}`;
  const headers = { "X-LegalWork-Host-Token": "host", "Content-Type": "application/json" };
  expect((await fetch(`${base}/workspace/${originalId}/reconnect`, { method: "POST", headers, body: JSON.stringify({ folderPath: f.b, expectedPath: f.a }) })).ok).toBe(true);
  await mkdir(f.a); await writeFile(join(f.a, "unrelated.pdf"), "new original");
  const response = await fetch(`${base}/workspaces/local`, { method: "POST", headers, body: JSON.stringify({ folderPath: f.a, registerExisting: true, appFiles: "outside", name: "Unrelated" }) });
  expect(response.status).toBe(201); const next = await response.json(); expect(next.activeId).not.toBe(originalId);
  const moved = f.config.workspaces.find(entry => entry.id === originalId)!;
  const unrelated = f.config.workspaces.find(entry => entry.id === next.activeId)!;
  const { externalAppFilesRoot } = await import("./lawoss/workspace-app-files.js");
  expect(moved.path).toBe(f.b); expect(f.config.workspaces).toHaveLength(2);
  expect(externalAppFilesRoot(f.config, unrelated)).not.toBe(externalAppFilesRoot(f.config, moved));
  expect((await fetch(`${base}/workspace/${next.activeId}/opencode/session/original-chat/message`, { headers: { Authorization: "Bearer client" } })).status).toBe(404);
  expect((await fetch(`${base}/workspace/${originalId}/opencode/session/original-chat/message`, { headers: { Authorization: "Bearer client" } })).status).toBe(200);
  expect(await readFile(join(f.b, "source.pdf"), "utf8")).toBe("%PDF-original");
});

test("supported session rebind preserves subdirectories and rolls back on persistence failure", async () => {
  const f = await fixture(a => mkdir(join(a, "sub"))); await rename(f.a, f.b);
  const engine = fakeEngineV2({ sessions: [{ id: "root-chat", title: "Root", directory: f.a, created: 1, updated: 2 }, { id: "nested-chat", title: "Case", directory: join(f.a, "sub"), created: 1, updated: 1 }] });
  cleanup.push(async () => engine.stop()); f.config.opencodeBaseUrl = engine.url;
  const directory = (id: string) => engine.sessions.get(id)?.directory;
  f.config.configPath = f.root; expect((await f.request()).ok).toBe(false);
  expect(directory("root-chat")).toBe(f.a); expect(directory("nested-chat")).toBe(join(f.a, "sub")); expect(f.config.workspaces[0]?.path).toBe(f.a);
  expect(engine.moves().slice(0, 2).map(move => move.body)).toEqual([{ directory: f.b }, { directory: join(f.b, "sub") }]);
  f.config.configPath = join(f.root, "server.json"); expect((await f.request()).ok).toBe(true);
  expect(directory("root-chat")).toBe(f.b); expect(directory("nested-chat")).toBe(join(f.b, "sub"));
  // The case chat keeps working in its subfolder of the reconnected client.
  expect((await fetch(`http://127.0.0.1:${f.server.port}/workspace/stable/sessions/nested-chat`, { headers: { Authorization: "Bearer client" } })).status).toBe(200);
  expect(await readFile(join(f.b, "source.pdf"), "utf8")).toBe("%PDF-original");
});

test("unsupported session rebind and nested destination escape fail without registry changes", async () => {
  const f = await fixture(async (a, root) => { await mkdir(join(root, "outside")); await symlink(join(root, "outside"), join(a, "linked")); }); await rename(f.a, f.b);
  const engine = fakeEngineV2({ sessions: [{ id: "original", title: "Original", directory: f.a, created: 1, updated: 1 }], onMove: () => Response.json({ name: "NotFoundError" }, { status: 404 }) });
  cleanup.push(async () => engine.stop()); f.config.opencodeBaseUrl = engine.url;
  expect((await f.request()).ok).toBe(false); expect(f.config.workspaces[0]?.path).toBe(f.a); expect(engine.moves()).toHaveLength(1);
  engine.sessions.get("original")!.directory = join(f.a, "linked");
  expect((await f.request()).ok).toBe(false); expect(engine.moves()).toHaveLength(1); expect(f.config.authorizedRoots).toEqual([f.a]);
});

test("failed engine rollback reports reconciliation instead of successful recovery", async () => {
  const f = await fixture(); await rename(f.a, f.b); let attempts = 0;
  const engine = fakeEngineV2({ sessions: [{ id: "original", title: "Original", directory: f.a, created: 1, updated: 1 }],
    onMove: () => ++attempts > 1 ? Response.json({ name: "UnknownError", data: { message: "engine interrupted" } }, { status: 500 }) : undefined });
  cleanup.push(async () => engine.stop()); f.config.opencodeBaseUrl = engine.url; f.config.configPath = f.root;
  const response = await f.request(); expect(response.ok).toBe(false);
  expect(await response.json()).toMatchObject({ code: "workspace_recovery_rollback_failed", details: { reconciliationRequired: true, workspaceId: "stable", previousPath: f.a, destinationPath: f.b, sessionIds: ["original"] } });
  expect(engine.sessions.get("original")?.directory).toBe(f.b); expect(f.config.workspaces[0]?.path).toBe(f.a);
});

test.each(["relative", "absolute"])("reused old folder never supplies another case's memory with %s profile", async kind => {
  const f=await fixture();const vault=join(f.root,"vault");await mkdir(vault);await writeFile(join(vault,"note.md"),"independent vault");await writeFile(join(f.a,"_memory.md"),"SHARED-ANCHOR ORIGINAL-MATTER-MEMORY");
  const { externalMemoryProfilePath }=await import("./lawoss/workspace-app-files.js");const profile=externalMemoryProfilePath(f.config,f.config.workspaces[0]!);if(!profile)throw new Error("missing profile location");await mkdir(join(profile,".."),{recursive:true});
  await writeFile(profile,JSON.stringify({version:1,matterId:"original",roots:[{id:"client",path:kind==="relative"?".":f.a}],sources:[{id:"memory",root:"client",path:"_memory.md",role:"case_memory",required:true,writable:false,anchors:["SHARED-ANCHOR"]}]}));
  const {writeRuntimeOpencodeConfig}=await import("./runtime-opencode-config-store.js");await writeRuntimeOpencodeConfig(f.config,"stable",()=>nativeRow({permission:{external_directory:{[`${f.a}/*`]:"allow",[`${f.root}/*`]:"allow",[`${vault}/*`]:"allow"}}}));
  await rename(f.a,f.b);expect((await f.request()).ok).toBe(true);await mkdir(f.a);await writeFile(join(f.a,"_memory.md"),"SHARED-ANCHOR UNRELATED-NEW-A-MEMORY");
  const base=`http://127.0.0.1:${f.server.port}`;const host={"X-LegalWork-Host-Token":"host","Content-Type":"application/json"};
  expect((await fetch(`${base}/workspaces/local`,{method:"POST",headers:host,body:JSON.stringify({folderPath:f.a,registerExisting:true,appFiles:"outside",name:"Unrelated"})})).status).toBe(201);
  const headers={Authorization:"Bearer client"};const response=await fetch(`${base}/workspace/stable/lawoss/memory`,{headers});expect(response.status).toBe(200);const status=await response.json();
  expect(status.complete).toBe(kind==="relative");expect(status.grants.folders).toEqual([f.root,vault]);expect(status.grants.folders).not.toContain(f.a);
  const raw=await fetch(`${base}/workspace/stable/files/raw?path=_memory.md`,{headers});expect(await raw.text()).toBe("SHARED-ANCHOR ORIGINAL-MATTER-MEMORY");
  const {createHash}=await import("node:crypto");const foreignHash=createHash("sha256").update("SHARED-ANCHOR UNRELATED-NEW-A-MEMORY").digest("hex");expect(status.sources.every((source:{sha256:string|null})=>source.sha256!==foreignHash)).toBe(true);
});

test("failed host persistence restores project-owned memory grants", async () => {
  const f=await fixture();const {writeRuntimeOpencodeConfig,readRuntimeOpencodeConfig,runtimeExternalDirectory}=await import("./runtime-opencode-config-store.js");
  const rules={[`${f.a}/*`]:"allow"};await writeRuntimeOpencodeConfig(f.config,"stable",()=>nativeRow({permission:{external_directory:rules}}));
  f.config.reconnectHostWorkspace=async()=>{throw new Error("host storage failed")};await rename(f.a,f.b);expect((await f.request()).ok).toBe(false);
  expect(runtimeExternalDirectory(await readRuntimeOpencodeConfig(f.config,"stable"))).toEqual(nativeRow({permission:{external_directory:rules}}).permissions ?? []);expect(f.config.workspaces[0]?.path).toBe(f.a);
});

test("reconnect captures native archived-zero and genuinely archived history as well as SQL-null history, preserving restart and future-foreign isolation", async () => {
  const f = await fixture();
  const authorization = "Basic " + Buffer.from("synthetic:local").toString("base64");
  // LAWOSS v2: one list without an archived filter selects active and archived chats alike.
  const engine = fakeEngineV2({ authorization, sessions: [
    { id: "native-zero", directory: f.a, title: "Native", created: 1, updated: 3 },
    { id: "legacy-null", directory: f.a, title: "Legacy", created: 1, updated: 2 },
    { id: "genuine-archive", directory: f.a, title: "Archived", created: 1, updated: 1, archived: 1 },
    { id: "foreign-project", directory: join(f.root, "elsewhere"), title: "Foreign", created: 1, updated: 4 },
  ] });
  cleanup.push(async () => engine.stop());
  f.config.opencodeBaseUrl = engine.url; f.config.opencodeUsername = "synthetic"; f.config.opencodePassword = "local";
  await rename(f.a, f.b); expect((await f.request()).status).toBe(200);
  const moved = engine.moves().map(move => move.sessionID);
  expect(new Set(moved)).toEqual(new Set(["native-zero", "legacy-null", "genuine-archive"]));
  expect(engine.moves().every(move => JSON.stringify(move.body) === JSON.stringify({ directory: f.b }))).toBe(true);
  expect(new Set(f.config.workspaces[0]?.previousSessionIds)).toEqual(new Set(moved));
  expect(engine.requests.filter(request => request.path === "/api/session" && request.method === "GET").some(request => request.search.has("archived"))).toBe(false);
  const persisted = JSON.parse(await readFile(f.config.configPath!, "utf8"));
  await mkdir(f.a); engine.create({ id: "future-foreign", directory: f.a, title: "Later reused path" });
  const restarted = await startServer({ ...f.config, port: 0, workspaces: buildWorkspaceInfos(persisted.workspaces, f.root), authorizedRoots: persisted.authorizedRoots }); cleanup.push(() => Promise.resolve(restarted.stop()));
  const base = `http://127.0.0.1:${restarted.port}/workspace/stable`, headers = { Authorization: "Bearer client" };
  for (const path of ["/sessions", "/opencode/session"]) {
    const response = await fetch(base + path, { headers }); expect(response.status).toBe(200);
    const body = await response.json();
    expect(new Set((Array.isArray(body.data) ? body.data : body.items).map((session: { id: string }) => session.id))).toEqual(new Set(moved));
  }
  expect((await fetch(`${base}/opencode/session/native-zero`, { headers })).status).toBe(200);
  expect((await fetch(`${base}/opencode/session/future-foreign`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/opencode/session/foreign-project`, { headers })).status).toBe(404);
  expect(persisted.authorizedRoots).toEqual([f.b]); expect(await readFile(join(f.b, "source.pdf"), "utf8")).toBe("%PDF-original");
});

test("with AI boundaries off (alpha default), native mounted session list and getters exclude later foreign chats reusing old path", async () => {
  const f = await fixture(); f.config.workspaces[0]!.directory = f.a;
  const engine = fakeEngineV2({ sessions: [{ id: "original", title: "Original", directory: f.a, created: 1, updated: 1 }] }); cleanup.push(async () => engine.stop());
  f.config.opencodeBaseUrl = engine.url;
  await rename(f.a, f.b); expect((await f.request()).ok).toBe(true);
  await mkdir(f.a); engine.create({ id: "foreign-late", title: "Foreign", directory: f.a });
  const base = `http://127.0.0.1:${f.server.port}/workspace/stable`;
  const headers = { Authorization: "Bearer client" };
  const list = await fetch(`${base}/opencode/session`, { headers });
  expect(list.status).toBe(200); expect((await list.json()).data.map((item: { id: string }) => item.id)).toEqual(["original"]);
  const ordinary = await fetch(`${base}/sessions`, { headers });
  expect(ordinary.status).toBe(200); expect((await ordinary.json()).items.map((item: { id: string }) => item.id)).toEqual(["original"]);
  expect((await fetch(`${base}/opencode/session/original`, { headers })).status).toBe(200);
  // The moved chat runs its tools in the reconnected folder (engine v2 `session.move`).
  const shell = await fetch(`${base}/opencode/session/original/shell`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ command: "pwd" }) });
  expect(shell.status).toBe(200); expect(await shell.json()).toEqual({ data: { directory: f.b } });
  expect((await fetch(`${base}/opencode/session/foreign-late/message`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/sessions/foreign-late/messages`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/opencode/experimental/session`, { headers })).status).toBe(403);
});

// LAWOSS v2: the supported move with the real engine (`LEGALWORK_TEST_OPENCODE_BIN`): the captured chat and its
// case chat run in the reconnected folder; a later chat reusing the old path stays foreign.
test.skipIf(!process.env.LEGALWORK_TEST_OPENCODE_BIN)("real engine v2: reconnect moves captured chats and keeps later old-path chats foreign", async () => {
  const f = await fixture(a => mkdir(join(a, "Spis")));
  const engine = await startRealEngineV2(process.env.LEGALWORK_TEST_OPENCODE_BIN ?? "", join(f.root, "engine"), cleanup);
  const client = OpenCode.make({ baseUrl: engine.url, headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
  const root = await client.session.create({ location: { directory: f.a }, title: "Koreň" });
  const matter = await client.session.create({ location: { directory: join(f.a, "Spis") }, title: "Prípad" });
  f.config.opencodeBaseUrl = engine.url; f.config.opencodeUsername = engine.username; f.config.opencodePassword = engine.password;
  await rename(f.a, f.b); expect((await f.request()).status).toBe(200);
  expect((await client.session.get({ sessionID: root.id })).location.directory).toBe(f.b);
  expect((await client.session.get({ sessionID: matter.id })).location.directory).toBe(join(f.b, "Spis"));
  await mkdir(f.a);
  const late = await client.session.create({ location: { directory: f.a }, title: "Cudzí neskôr" });
  const base = `http://127.0.0.1:${f.server.port}/workspace/stable`, headers = { Authorization: "Bearer client" };
  const items = (await (await fetch(`${base}/sessions`, { headers })).json()).items.map((item: { id: string }) => item.id).sort();
  expect(items).toEqual([root.id, matter.id].sort());
  for (const id of [root.id, matter.id]) expect((await fetch(`${base}/sessions/${id}/messages`, { headers })).status).toBe(200);
  expect((await fetch(`${base}/opencode/session/${late.id}`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/sessions/${late.id}`, { headers })).status).toBe(404);
}, 60_000);
