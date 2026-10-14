import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rename, readFile, writeFile, rm, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeSyntheticTestDir } from "./lawoss/test-support/inspect-cleanup.js";
import { startServer } from "./server.js";
import { buildWorkspaceInfos } from "./workspaces.js";
import type { ServerConfig } from "./types.js";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "reconnect-")));
  cleanup.push(() => removeSyntheticTestDir(root));
  const a = join(root, "A"), b = join(root, "B");
  await mkdir(a); await writeFile(join(a, "source.pdf"), "%PDF-original");
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
  const engine = Bun.serve({ port: 0, fetch: request => {
    const url = new URL(request.url);
    if (url.pathname === "/experimental/control-plane/move-session") return new Response(null, { status: 204 });
    const directory = url.pathname === "/experimental/session" ? f.a : f.b;
    expect(url.searchParams.get("directory")).toBe(url.pathname === "/experimental/session" ? null : f.b);
    expect(request.headers.get("x-opencode-directory")).toBe(f.b);
    return Response.json(directory === f.a ? [{ id: "chat-original", directory: f.a, title: "Original", time: { updated: 1 } }] : []);
  } }); cleanup.push(() => Promise.resolve(engine.stop(true)));
  f.config.opencodeBaseUrl = `http://127.0.0.1:${engine.port}`;
  await rename(f.a, f.b); expect((await f.request()).ok).toBe(true);
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
  f.config.workspaces[0]!.workspaceType = "remote";
  expect((await f.request()).ok).toBe(false); expect(f.config.workspaces[0]?.path).toBe(f.a);
  expect(await readFile(join(f.b, "source.pdf"), "utf8")).toBe("%PDF-original");
});

test("native mounted session list and getters exclude later foreign chats reusing old path", async () => {
  const f = await fixture(); f.config.workspaces[0]!.directory = f.a; let late = false;
  const engine = Bun.serve({ port: 0, fetch: request => {
    const url = new URL(request.url);
    expect(request.headers.get("x-opencode-directory")).toBe(f.b);
    const original = { id: "original", directory: f.a, title: "Original", time: { updated: 1 } };
    const foreign = { id: "foreign-late", directory: f.a, title: "Foreign", time: { updated: 2 } };
    if (url.pathname === "/experimental/control-plane/move-session") return new Response(null, { status: 204 });
    if (url.pathname === "/experimental/session") return Response.json(late ? [foreign, original] : [original]);
    if (url.pathname === "/session") return Response.json([foreign]);
    if (url.pathname === "/session/original") { expect(request.headers.get("content-length")).toBeNull(); return Response.json(original); }
    if (url.pathname === "/session/original/shell") return Response.json({ cwd: f.b });
    if (url.pathname === "/session/foreign-late") return Response.json(foreign);
    return Response.json([]);
  } }); cleanup.push(() => Promise.resolve(engine.stop(true)));
  f.config.opencodeBaseUrl = `http://127.0.0.1:${engine.port}`;
  await rename(f.a, f.b); expect((await f.request()).ok).toBe(true); late = true;
  const base = `http://127.0.0.1:${f.server.port}/workspace/stable`;
  const headers = { Authorization: "Bearer client" };
  const list = await fetch(`${base}/opencode/session`, { headers });
  expect(list.status).toBe(200); expect((await list.json()).map((item: { id: string }) => item.id)).toEqual(["original"]);
  const ordinary = await fetch(`${base}/sessions`, { headers });
  expect(ordinary.status).toBe(200); expect((await ordinary.json()).items.map((item: { id: string }) => item.id)).toEqual(["original"]);
  expect((await fetch(`${base}/opencode/session/original`, { headers })).status).toBe(200);
  const shell = await fetch(`${base}/opencode/session/original/shell`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ agent: "build", command: "pwd" }) });
  expect(shell.status).toBe(200); expect(await shell.json()).toEqual({ cwd: f.b });
  expect((await fetch(`${base}/opencode/session/foreign-late/message`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/sessions/foreign-late/messages`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/opencode/experimental/session`, { headers })).status).toBe(403);
});

test.each(["derived", "custom"])("registering a freed path allocates distinct ID and storage for %s identity", async identity => {
  const { workspaceIdForPath } = await import("./workspaces.js");
  const f = await fixture(); const originalId = identity === "derived" ? workspaceIdForPath(f.a) : "stable"; f.config.workspaces[0]!.id = originalId;
  let sessionDirectory = f.a;
  const engine = Bun.serve({ port: 0, fetch: async request => {
    const path = new URL(request.url).pathname;
    if (path === "/experimental/session") return Response.json([{ id: "original-chat", directory: sessionDirectory, time: { updated: 1 } }]);
    if (path === "/experimental/control-plane/move-session") { sessionDirectory = (await request.json()).destination.directory; return new Response(null, { status: 204 }); }
    if (path === "/session/original-chat") return Response.json({ id: "original-chat", directory: sessionDirectory, time: { updated: 1 } });
    return Response.json([]);
  } }); cleanup.push(() => Promise.resolve(engine.stop(true))); f.config.opencodeBaseUrl = `http://127.0.0.1:${engine.port}`;
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
  expect(await readFile(join(f.b, "source.pdf"), "utf8")).toBe("%PDF-original");
});

test("supported session rebind preserves subdirectories and rolls back on persistence failure", async () => {
  const f = await fixture(); await mkdir(join(f.a, "sub")); await rename(f.a, f.b);
  const directories = new Map([["root-chat", f.a], ["nested-chat", join(f.a, "sub")]]);
  const moves: Array<{ sessionID: string; destination: { directory: string }; moveChanges: boolean }> = [];
  const engine = Bun.serve({ port: 0, fetch: async request => {
    const url = new URL(request.url); expect(request.headers.get("x-opencode-directory")).toBe(f.b);
    if (url.pathname === "/experimental/session") return Response.json([...directories].map(([id,directory]) => ({id,directory,time:{updated:1}})));
    if (url.pathname === "/experimental/control-plane/move-session") {
      const body = await request.json(); moves.push(body); directories.set(body.sessionID, body.destination.directory); return new Response(null,{status:204});
    }
    return Response.json([]);
  } }); cleanup.push(() => Promise.resolve(engine.stop(true))); f.config.opencodeBaseUrl = `http://127.0.0.1:${engine.port}`;
  f.config.configPath = f.root; expect((await f.request()).ok).toBe(false);
  expect(directories.get("root-chat")).toBe(f.a); expect(directories.get("nested-chat")).toBe(join(f.a,"sub")); expect(f.config.workspaces[0]?.path).toBe(f.a);
  expect(moves.slice(0,2).map(move=>move.destination.directory)).toEqual([f.b,join(f.b,"sub")]); expect(moves.every(move=>move.moveChanges===false)).toBe(true);
  f.config.configPath=join(f.root,"server.json"); expect((await f.request()).ok).toBe(true);
  expect(directories.get("root-chat")).toBe(f.b); expect(directories.get("nested-chat")).toBe(join(f.b,"sub"));
  expect(await readFile(join(f.b,"source.pdf"),"utf8")).toBe("%PDF-original");
});

test("unsupported session rebind and nested destination escape fail without registry changes", async () => {
  const f = await fixture(); const outside = join(f.root,"outside"); await mkdir(outside); await symlink(outside,join(f.a,"linked")); await rename(f.a,f.b);
  let nested = false; let moves = 0;
  const engine=Bun.serve({port:0,fetch:request=>{
    if(new URL(request.url).pathname==="/experimental/session") return Response.json([{id:"original",directory:nested?join(f.a,"linked"):f.a,time:{updated:1}}]);
    moves++; return Response.json({error:"unsupported"},{status:404});
  }});cleanup.push(()=>Promise.resolve(engine.stop(true)));f.config.opencodeBaseUrl=`http://127.0.0.1:${engine.port}`;
  expect((await f.request()).ok).toBe(false); expect(f.config.workspaces[0]?.path).toBe(f.a); expect(moves).toBe(1);
  nested=true; expect((await f.request()).ok).toBe(false); expect(moves).toBe(1); expect(f.config.authorizedRoots).toEqual([f.a]);
});

test("failed engine rollback reports reconciliation instead of successful recovery", async () => {
  const f=await fixture();await rename(f.a,f.b);let directory=f.a;let attempts=0;
  const engine=Bun.serve({port:0,fetch:async request=>{
    if(new URL(request.url).pathname==="/experimental/session")return Response.json([{id:"original",directory,time:{updated:1}}]);
    attempts++;if(attempts>1)return Response.json({error:"engine interrupted"},{status:500});
    directory=(await request.json()).destination.directory;return new Response(null,{status:204});
  }});cleanup.push(()=>Promise.resolve(engine.stop(true)));f.config.opencodeBaseUrl=`http://127.0.0.1:${engine.port}`;f.config.configPath=f.root;
  const response=await f.request();expect(response.ok).toBe(false);
  expect(await response.json()).toMatchObject({code:"workspace_recovery_rollback_failed",details:{reconciliationRequired:true,workspaceId:"stable",previousPath:f.a,destinationPath:f.b,sessionIds:["original"]}});
  expect(directory).toBe(f.b);expect(f.config.workspaces[0]?.path).toBe(f.a);
});

test.each(["relative", "absolute"])("reused old folder never supplies another case's memory with %s profile", async kind => {
  const f=await fixture();const vault=join(f.root,"vault");await mkdir(vault);await writeFile(join(vault,"note.md"),"independent vault");await writeFile(join(f.a,"_memory.md"),"SHARED-ANCHOR ORIGINAL-MATTER-MEMORY");
  const { externalMemoryProfilePath }=await import("./lawoss/workspace-app-files.js");const profile=externalMemoryProfilePath(f.config,f.config.workspaces[0]!);if(!profile)throw new Error("missing profile location");await mkdir(join(profile,".."),{recursive:true});
  await writeFile(profile,JSON.stringify({version:1,matterId:"original",roots:[{id:"client",path:kind==="relative"?".":f.a}],sources:[{id:"memory",root:"client",path:"_memory.md",role:"case_memory",required:true,writable:false,anchors:["SHARED-ANCHOR"]}]}));
  const {writeRuntimeOpencodeConfig}=await import("./runtime-opencode-config-store.js");await writeRuntimeOpencodeConfig(f.config,"stable",()=>({permission:{external_directory:{[`${f.a}/*`]:"allow",[`${f.root}/*`]:"allow",[`${vault}/*`]:"allow"}}}));
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
  const rules={[`${f.a}/*`]:"allow"};await writeRuntimeOpencodeConfig(f.config,"stable",()=>({permission:{external_directory:rules}}));
  f.config.reconnectHostWorkspace=async()=>{throw new Error("host storage failed")};await rename(f.a,f.b);expect((await f.request()).ok).toBe(false);
  expect(runtimeExternalDirectory(await readRuntimeOpencodeConfig(f.config,"stable"))).toEqual(rules);expect(f.config.workspaces[0]?.path).toBe(f.a);
});

test("reconnect captures native archived-zero and genuinely archived history as well as SQL-null history, preserving restart and future-foreign isolation",async()=>{
 const f=await fixture();
 const sessions=[
  {id:"native-zero",directory:f.a,title:"Native",time:{created:1,updated:3,archived:0}},
  // The engine API omits archived for SQL NULL.
  {id:"legacy-null",directory:f.a,title:"Legacy",time:{created:1,updated:2}},
  {id:"genuine-archive",directory:f.a,title:"Archived",time:{created:1,updated:1,archived:1}},
  {id:"foreign-project",directory:join(f.root,"elsewhere"),title:"Foreign",time:{created:1,updated:4,archived:0}},
 ];
 let late=false;const moved:string[]=[];
 const engine=Bun.serve({port:0,fetch:async request=>{
  expect(request.headers.get("authorization")).toBe("Basic "+Buffer.from("synthetic:local").toString("base64"));
  const url=new URL(request.url),all=late?[...sessions,{id:"future-foreign",directory:f.a,title:"Later reused path",time:{created:4,updated:5,archived:0}}]:sessions;
  if(url.pathname==="/experimental/session"){
   expect(url.searchParams.get("directory")).toBeNull();expect(url.searchParams.get("limit")).toBe("1000");
   return Response.json(url.searchParams.get("archived")==="true"?all:all.filter(session=>!("archived" in session.time)));
  }
  if(url.pathname==="/experimental/control-plane/move-session"){
   const body=await request.json();expect(body.moveChanges).toBe(false);expect(body.destination.directory).toBe(f.b);
   const session=sessions.find(item=>item.id===body.sessionID);expect(session).toBeDefined();session!.directory=body.destination.directory;moved.push(session!.id);
   return new Response(null,{status:204});
  }
  if(url.pathname==="/session")return Response.json(all);
  const id=url.pathname.split("/")[2];return Response.json(all.find(session=>session.id===id));
 }});cleanup.push(()=>Promise.resolve(engine.stop(true)));
 f.config.opencodeBaseUrl=`http://127.0.0.1:${engine.port}`;f.config.opencodeUsername="synthetic";f.config.opencodePassword="local";
 await rename(f.a,f.b);expect((await f.request()).status).toBe(200);
 expect(new Set(moved)).toEqual(new Set(["native-zero","legacy-null","genuine-archive"]));
 expect(new Set(f.config.workspaces[0]?.previousSessionIds)).toEqual(new Set(moved));
 const persisted=JSON.parse(await readFile(f.config.configPath!,"utf8"));late=true;
 const restarted=await startServer({...f.config,port:0,workspaces:buildWorkspaceInfos(persisted.workspaces,f.root),authorizedRoots:persisted.authorizedRoots});cleanup.push(()=>Promise.resolve(restarted.stop()));
 const base=`http://127.0.0.1:${restarted.port}/workspace/stable`,headers={Authorization:"Bearer client"};
 for(const path of ["/sessions","/opencode/session"]){const response=await fetch(base+path,{headers});expect(response.status).toBe(200);const body=await response.json();expect(new Set((Array.isArray(body)?body:body.items).map((session:{id:string})=>session.id))).toEqual(new Set(moved));}
 expect((await fetch(`${base}/opencode/session/native-zero`,{headers})).status).toBe(200);
 expect((await fetch(`${base}/opencode/session/future-foreign`,{headers})).status).toBe(404);
 expect((await fetch(`${base}/opencode/session/foreign-project`,{headers})).status).toBe(404);
 expect(persisted.authorizedRoots).toEqual([f.b]);expect(await readFile(join(f.b,"source.pdf"),"utf8")).toBe("%PDF-original");
});
