import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat, symlink } from "node:fs/promises";

import {
  createRuntimeManager,
  alignWindowsOpencodeConfigEnv,
  desktopProjectsDirectory,
  externalWorkspaceAppFilesRoot,
  commandMatchesPackagedSidecar,
  mergeRuntimeMcpConfig,
  bundledNodeDirectory,
  childProcessPath,
  nodeShimFileName,
  nodeShimScriptContent,
  opencodeHomeEnvFromRoot,
  prioritizeWorkspacePaths,
  resolveLegalworkServerConfigPath,
  seedWorkspacePathsForEmbeddedServer,
  selectStickyLegalworkPortWorkspace,
  usesExternalWorkspaceAppFiles,
} from "./runtime.mjs";

function constructorOptions(root, events, onStartupCheckpoint, failure) {
  return {
    app: { isPackaged: true, getPath(key) {
      events.push(`path:${key}`);
      if (key === 'documents' && failure) throw failure;
      return path.join(root, key);
    } },
    desktopRoot: path.join(root, 'desktop'),
    listLocalWorkspacePaths: async () => [], listLocalWorkspaceAppFiles: async () => ({}),
    listLocalWorkspaces: async () => [], reconnectHostWorkspace: async () => null,
    recorder: undefined, getApprovalWindow: () => null, onSidecarExit: () => {}, onStartupCheckpoint,
  };
}
it('runtime constructor checkpoints retain the original getPath order and completed boundaries', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lawoss-runtime-constructor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];
  const manager = createRuntimeManager(constructorOptions(root, events, phase => events.push(phase)));
  assert.equal(typeof manager.engineStart, 'function');
  assert.deepEqual(events, [
    'runtime-manager-entered', 'runtime-state-returned',
    'path:userData', 'runtime-user-data-returned', 'path:home', 'runtime-home-returned',
    'path:documents', 'runtime-documents-returned', 'path:exe', 'runtime-sidecars-returned',
    'path:userData', 'runtime-office-returned',
  ]);
});
it('runtime constructor preserves the exact original documents error even when observers throw', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lawoss-runtime-constructor-error-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const observerThrows of [false, true]) {
    const events = [], primary = Object.assign(new Error('private controlled Documents error'), { code: 'SYNTHETIC_DOCUMENTS_ERROR' });
    assert.throws(() => createRuntimeManager(constructorOptions(root, events, phase => {
      events.push(phase);
      if (observerThrows) throw new Error('private observer error');
    }, primary)), error => error === primary);
    assert.deepEqual(events, [
      'runtime-manager-entered', 'runtime-state-returned',
      'path:userData', 'runtime-user-data-returned', 'path:home', 'runtime-home-returned', 'path:documents',
    ]);
  }
});
it('runtime constructor observer failures preserve the default result shape and original calls', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lawoss-runtime-constructor-observer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ordinaryCalls = [], observedCalls = [], observations = [];
  const ordinary = createRuntimeManager(constructorOptions(root, ordinaryCalls));
  const observed = createRuntimeManager(constructorOptions(root, observedCalls, (...args) => {
    observations.push(args); throw new Error('private observer error');
  }));
  assert.deepEqual(ordinaryCalls, ['path:userData', 'path:home', 'path:documents', 'path:exe', 'path:userData']);
  assert.deepEqual(observedCalls, ordinaryCalls);
  assert.deepEqual(Object.keys(observed), Object.keys(ordinary));
  assert.ok(Object.values(observed).every(value => typeof value === 'function'));
  assert.deepEqual(observations, [
    ['runtime-manager-entered'], ['runtime-state-returned'], ['runtime-user-data-returned'],
    ['runtime-home-returned'], ['runtime-documents-returned'], ['runtime-sidecars-returned'], ['runtime-office-returned'],
  ]);
});

it("engine doctor bounds actual probes and preserves primary startup failures", { timeout: 20_000 }, async () => {
  // Builtin ESM bindings are process-wide: isolate the adapter and restore it
  // inside the fixture, without sharing it with other runtime tests.
  const { spawnSync } = await import("node:child_process");
  const root = await mkdtemp(path.join(os.tmpdir(), "lawoss-doctor-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(LEGALWORK_|OPENCODE_|XDG_)/.test(key)) delete env[key];
  }
  Object.assign(env, {
    HOME: root, USERPROFILE: root, PATH: "", LEGALWORK_ENV_STORE: path.join(root, "env.json"),
    LEGALWORK_SERVER_CONFIG: path.join(root, "server.json"), LEGALWORK_DATA_DIR: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"),
  });
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./runtime-doctor.fixture.mjs", import.meta.url))], {
      env, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /doctor controls passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe("workspace app files policy", () => {
  it("requires an explicit outside policy before skipping project setup", () => {
    assert.equal(usesExternalWorkspaceAppFiles({ appFiles: "outside" }), true);
    assert.equal(usesExternalWorkspaceAppFiles({ appFiles: "inside" }), false);
    assert.equal(usesExternalWorkspaceAppFiles({}), false);
  });
});

describe("outside app-files root", () => {
  it("uses the same config-directory and canonical-path hash contract as the server", () => {
    const configPath = path.resolve(os.tmpdir(), "lawyer", ".config", "legalwork", "server.json");
    const workspace = path.resolve(os.tmpdir(), "lawyer", "Cases", "Matter");
    const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex");
    assert.equal(
      externalWorkspaceAppFilesRoot(configPath, workspace),
      path.join(path.dirname(configPath), "workspace-app-files", hash),
    );
  });

  it("resolves relative config and workspace paths before deriving the external root", () => {
    const configPath = path.join("config", "server.json");
    const workspace = path.join("Cases", "Matter");
    const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex");
    assert.equal(
      externalWorkspaceAppFilesRoot(configPath, workspace),
      path.join(process.cwd(), "config", "workspace-app-files", hash),
    );
  });
});

describe("alignWindowsOpencodeConfigEnv", () => {
  it("keeps the engine and LegalWork on OpenCode's existing Windows config root", () => {
    const env = { APPDATA: "C:\\Users\\lawyer\\AppData\\Roaming" };
    assert.equal(alignWindowsOpencodeConfigEnv(env, "win32", "C:\\Users\\lawyer").XDG_CONFIG_HOME, path.join("C:\\Users\\lawyer", ".config"));
    assert.equal(env.OPENCODE_CONFIG_DIR, undefined);
  });

  it("preserves an explicit XDG config home", () => {
    const env = { APPDATA: "C:\\Users\\lawyer\\AppData\\Roaming", XDG_CONFIG_HOME: "D:\\opencode" };
    assert.equal(alignWindowsOpencodeConfigEnv(env, "win32").XDG_CONFIG_HOME, "D:\\opencode");
    assert.equal(env.OPENCODE_CONFIG_DIR, undefined);
  });

  it("preserves an explicit OpenCode config directory", () => {
    const env = { APPDATA: "C:\\Users\\lawyer\\AppData\\Roaming", OPENCODE_CONFIG_DIR: "D:\\opencode" };
    assert.equal(alignWindowsOpencodeConfigEnv(env, "win32").OPENCODE_CONFIG_DIR, "D:\\opencode");
    assert.equal(env.XDG_CONFIG_HOME, path.join(os.homedir(), ".config"));
  });

  it("does not change Unix config paths", () => {
    const env = { APPDATA: "/other" };
    assert.equal(alignWindowsOpencodeConfigEnv(env, "darwin").XDG_CONFIG_HOME, undefined);
  });
});

describe("opencodeHomeEnvFromRoot", () => {
  it("points every OpenCode dir under the app-owned root", () => {
    const root = path.join("/tmp", "userData", "opencode-home");
    const env = opencodeHomeEnvFromRoot(root);
    assert.equal(env.XDG_CONFIG_HOME, path.join(root, "config"));
    assert.equal(env.XDG_DATA_HOME, path.join(root, "data"));
    assert.equal(env.XDG_CACHE_HOME, path.join(root, "cache"));
    assert.equal(env.XDG_STATE_HOME, path.join(root, "state"));
    // The config dir must live under XDG_CONFIG_HOME so opencode and any XDG
    // reader agree on the same location.
    assert.equal(env.OPENCODE_CONFIG_DIR, path.join(env.XDG_CONFIG_HOME, "opencode"));
  });
});

describe("prioritizeWorkspacePaths", () => {
  it("keeps the active runtime workspace first", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current", ["/workspace/other", "/workspace/current"]),
      ["/workspace/current", "/workspace/other"],
    );
  });

  it("dedupes equivalent paths", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current/../current", ["/workspace/current"]),
      ["/workspace/current/../current"],
    );
  });
});

describe("seedWorkspacePathsForEmbeddedServer", () => {
  it("uses persisted server config instead of Electron workspace state once config exists", () => {
    assert.deepEqual(
      seedWorkspacePathsForEmbeddedServer(["/workspace/legacy"], true),
      [],
    );
  });

  it("seeds from Electron workspace state before server config exists", () => {
    assert.deepEqual(
      seedWorkspacePathsForEmbeddedServer(["/workspace/first"], false),
      ["/workspace/first"],
    );
  });
});

describe("selectStickyLegalworkPortWorkspace", () => {
  it("uses the requested workspace even when server config owns workspace loading", () => {
    assert.equal(
      selectStickyLegalworkPortWorkspace(["/workspace/current"], []),
      "/workspace/current",
    );
  });

  it("falls back to server workspace paths when no requested path is available", () => {
    assert.equal(
      selectStickyLegalworkPortWorkspace([], ["/workspace/from-server"]),
      "/workspace/from-server",
    );
  });
});

describe("commandMatchesPackagedSidecar", () => {
  it("matches packaged opencode sidecars with platform suffixes", () => {
    assert.equal(
      commandMatchesPackagedSidecar(
        "/Applications/LegalWork.app/Contents/Resources/sidecars/opencode-aarch64-apple-darwin serve --hostname 127.0.0.1 --port 49174 --cors *",
        ["/Applications/LegalWork.app/Contents/Resources/sidecars"],
      ),
      true,
    );
  });

  it("does not match unrelated opencode processes outside sidecar directories", () => {
    assert.equal(
      commandMatchesPackagedSidecar(
        "/usr/local/bin/opencode serve --hostname 127.0.0.1 --port 49174",
        ["/Applications/LegalWork.app/Contents/Resources/sidecars"],
      ),
      false,
    );
  });
});

describe("resolveLegalworkServerConfigPath", () => {
  it("respects explicit server config path", () => {
    assert.equal(
      resolveLegalworkServerConfigPath({ LEGALWORK_SERVER_CONFIG: "/tmp/legalwork/server.json" }),
      path.resolve("/tmp/legalwork/server.json"),
    );
  });

  it("uses XDG config home on Unix", () => {
    if (process.platform === "win32") return;
    assert.equal(
      resolveLegalworkServerConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg" }),
      "/tmp/xdg/legalwork/server.json",
    );
  });
});

describe("packaged Node runtime", () => {
  it("requires the bundled executable on every platform", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "legalwork-node-runtime-"));
    try {
      assert.throws(() => bundledNodeDirectory(root), /Bundled Node runtime is missing/);
      await mkdir(path.join(root, "node"));
      await writeFile(path.join(root, "node", "node"), "fixture");
      await writeFile(path.join(root, "node", "node.exe"), "fixture");
      /** @type {NodeJS.Platform[]} */
      const platforms = ["darwin", "linux", "win32"];
      for (const platform of platforms) assert.equal(bundledNodeDirectory(root, platform), path.join(root, "node"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("node shim", () => {
  it("names the shim node.cmd on Windows and node elsewhere", () => {
    assert.equal(nodeShimFileName("win32"), "node.cmd");
    assert.equal(nodeShimFileName("darwin"), "node");
    assert.equal(nodeShimFileName("linux"), "node");
  });

  it("re-execs the app binary in Node mode on posix", () => {
    assert.equal(
      nodeShimScriptContent("/Applications/LegalWork.app/Contents/MacOS/LegalWork", "darwin"),
      '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "/Applications/LegalWork.app/Contents/MacOS/LegalWork" "$@"\n',
    );
  });

  it("re-execs the app binary in Node mode on Windows", () => {
    assert.equal(
      nodeShimScriptContent("C:\\Program Files\\LegalWork\\LegalWork.exe", "win32"),
      '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Program Files\\LegalWork\\LegalWork.exe" %*\r\n',
    );
  });
});

// 🟡 LAWOSS: pribalený Node musí v zabalenej appke vyhrať nad starým systémovým,
// inak ESM bundle OKF (okf.js, okf-memory.js) bez package.json nenaštartuje.
describe("PATH potomkov a pribalený Node", () => {
  async function layout() {
    const root = await mkdtemp(path.join(os.tmpdir(), "lawoss-child-path-"));
    const dirs = {
      root,
      sidecars: path.join(root, "sidecars"),
      node: path.join(root, "node"),
      shim: path.join(root, "node-shim"),
      systemNode: path.join(root, "system-node"),
      other: path.join(root, "other"),
    };
    for (const dir of [dirs.sidecars, dirs.node, dirs.shim, dirs.systemNode, dirs.other]) await mkdir(dir);
    return dirs;
  }

  it("zabalená appka dá pribalený Node hneď za sidecary, pred systémový PATH", async () => {
    const dirs = await layout();
    try {
      const missing = path.join(dirs.root, "missing-sidecars");
      const systemPath = [dirs.systemNode, dirs.other].join(path.delimiter);
      const entries = childProcessPath([missing, dirs.sidecars], systemPath, dirs.node, true).split(path.delimiter);
      assert.deepEqual(entries.slice(0, 2), [dirs.sidecars, dirs.node]);
      assert.ok(entries.indexOf(dirs.systemNode) > entries.indexOf(dirs.node));
      assert.ok(entries.includes(dirs.other));
      assert.ok(!entries.includes(missing));
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  it("pribalený Node už v PATH používateľa sa neopakuje", async () => {
    const dirs = await layout();
    try {
      const systemPath = [dirs.systemNode, dirs.node].join(path.delimiter);
      const entries = childProcessPath([dirs.sidecars], systemPath, dirs.node, true).split(path.delimiter);
      assert.equal(entries.indexOf(dirs.node), 1);
      assert.equal(entries.filter((entry) => entry === dirs.node).length, 1);
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  it("vo vývoji ostáva shim Electronu na konci ako v upstreame", async () => {
    const dirs = await layout();
    try {
      const entries = childProcessPath([dirs.sidecars], dirs.systemNode, dirs.shim, false).split(path.delimiter);
      assert.equal(entries[0], dirs.sidecars);
      assert.equal(entries.at(-1), dirs.shim);
      assert.ok(entries.indexOf(dirs.systemNode) < entries.indexOf(dirs.shim));
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  it("bez shimu vo vývoji pridá len sidecary", async () => {
    const dirs = await layout();
    try {
      const entries = childProcessPath([dirs.sidecars], dirs.systemNode, null, false).split(path.delimiter);
      assert.equal(entries[0], dirs.sidecars);
      assert.equal(entries.at(-1), dirs.systemNode);
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });
});


describe("runtime MCP config removal", () => {
  for (const kind of ["xdg", "config", "database"]) {
    it(`removes from the engine's ${kind} path and preserves other settings`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "legalwork-mcp-profile-"));
      const env = kind === "database"
        ? { LEGALWORK_RUNTIME_DB: path.join(root, "runtime.sqlite") }
        : kind === "config"
          ? { LEGALWORK_SERVER_CONFIG: path.join(root, "server.json") }
          : process.platform === "win32" ? { APPDATA: root } : { XDG_CONFIG_HOME: root };
      try {
        const file = await mergeRuntimeMcpConfig("legalmemory", { type: "remote", url: "https://example.test/mcp", enabled: true }, env);
        assert.equal(file, path.join(root, ...(kind === "xdg" ? ["legalwork"] : []), "runtime-opencode-config.json"));
        const current = JSON.parse(await readFile(file, "utf8"));
        current.plugin = ["file:///test/plugin.js"];
        current.mcp.other = { type: "remote", url: "https://other.test/mcp" };
        await writeFile(file, JSON.stringify(current));
        await mergeRuntimeMcpConfig("legalmemory", null, env);
        const result = JSON.parse(await readFile(file, "utf8"));
        assert.equal(result.mcp.legalmemory, undefined);
        assert.deepEqual(result.mcp.other, current.mcp.other);
        assert.deepEqual(result.plugin, current.plugin);
        // Retrying a removal must stay disconnected.
        await mergeRuntimeMcpConfig("legalmemory", null, env);
        assert.deepEqual(JSON.parse(await readFile(file, "utf8")), result);
        await writeFile(file, "{broken");
        await assert.rejects(mergeRuntimeMcpConfig("legalmemory", null, env));
        assert.equal(await readFile(file, "utf8"), "{broken");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});


describe("desktop project storage", () => {
  it("keeps macOS projects in Documents outside the app installation and engine home", () => {
    assert.equal(desktopProjectsDirectory("/Users/chris/Documents", false, "darwin"), "/Users/chris/Documents/LegalWork/Projects");
  });
  it("uses the exact Windows known-folder location, including redirected Documents", () => {
    assert.equal(desktopProjectsDirectory("D:\\OneDrive - Firm\\Documents", false, "win32"), "D:\\OneDrive - Firm\\Documents\\LegalWork\\Projects");
    assert.equal(desktopProjectsDirectory("\\\\fileserver\\users\\chris\\Documents", false, "win32"), "\\\\fileserver\\users\\chris\\Documents\\LegalWork\\Projects");
  });
  it("keeps development-created projects separate from released app projects", () => {
    assert.equal(desktopProjectsDirectory("/Users/chris/Documents", true, "darwin"), "/Users/chris/Documents/LegalWork Dev/Projects");
  });
});


describe("selected existing project startup", () => {
  for (const appFiles of ["inside", "outside"]) {
    for (const kind of ["missing", "file"]) {
      it(`refuses ${kind} selected root before provisioning or runtime reset (${appFiles})`, async () => {
        const root=await mkdtemp(path.join(os.tmpdir(),"lawoss-runtime-missing-"));
        try {
          const selected=path.join(root,"selected-project");
          if(kind==="file")await writeFile(selected,"Synthetic source bytes");
          const manager=createRuntimeManager({app:{isPackaged:true,getPath:key=>key==="exe"?path.join(root,"app","Electron"):root},desktopRoot:path.join(root,"desktop"),listLocalWorkspacePaths:async()=>[],listLocalWorkspaceAppFiles:async()=>({}),listLocalWorkspaces:async()=>[],reconnectHostWorkspace:async()=>null,recorder:undefined,onSidecarExit:()=>{},getApprovalWindow:()=>null});
          const before=await manager.engineInfo();
          await assert.rejects(manager.engineStart(selected,{appFiles}),/Project folder is unavailable/);
          assert.deepEqual(await manager.engineInfo(),before,"Unavailable project must not disturb a runtime or its lifecycle");
          if(kind==="missing")assert.equal(await stat(selected).then(()=>true,()=>false),false,"No replacement empty directory may be created");
          else assert.equal(await readFile(selected,"utf8"),"Synthetic source bytes");
        } finally {await rm(root,{recursive:true,force:true});}
      });
    }
  }
});

for (const appFiles of ["inside","outside"]) it(`existing canonical aliases still reach ordinary runtime startup (${appFiles})`, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"lawoss-runtime-existing-"));
 const ownedBinary=path.join(root,"inert-opencode");
 const controlledCalls=[],unexpectedSync=[],unexpectedAsync=[];
 const syncMock=mock.method(childProcess,"spawnSync",(program,argv,options)=>{
  if(program==="/usr/libexec/path_helper"||program==="ps")return {status:0,stdout:"",stderr:""};
  if(program!==ownedBinary){unexpectedSync.push(program);throw new Error("Unowned diagnostic subprocess denied");}
  controlledCalls.push({argv,options});
  return {status:0,stdout:"synthetic-version",stderr:""};
 });
 const asyncMock=mock.method(childProcess,"spawn",()=>{unexpectedAsync.push(true);throw new Error("Unexpected startup child denied");});
 syncBuiltinESMExports();
 try {
  await writeFile(ownedBinary,"Inert diagnostic fixture; never executable");
  const target=path.join(root,"actual"),alias=path.join(root,"alias");await mkdir(target);await symlink(target,alias,process.platform==="win32"?"junction":"dir");
  const manager=createRuntimeManager({app:{isPackaged:true,getPath:key=>key==="exe"?path.join(root,"app","Electron"):root},desktopRoot:path.join(root,"desktop"),listLocalWorkspacePaths:async()=>[],listLocalWorkspaceAppFiles:async()=>({}),listLocalWorkspaces:async()=>[],reconnectHostWorkspace:async()=>null,recorder:undefined,onSidecarExit:()=>{},getApprovalWindow:()=>null});
  // This Node fixture has no packaged Node binary. The real existing-root
  // precondition must pass, without pretending the Electron engine launched.
  await assert.rejects(manager.engineStart(alias,{appFiles,opencodeBinPath:ownedBinary}),error=>!String(error).includes("Project folder is unavailable"));
  assert.equal((await manager.engineInfo()).lifecycleState,"error");
  assert.equal(unexpectedSync.length,0,"Automatic error diagnostics must not attempt an ambient binary");
  assert.equal(unexpectedAsync.length,0,"Startup must not attempt any real engine child");
  assert.deepEqual(controlledCalls,[
   {argv:["--version"],options:{encoding:"utf8",timeout:2000,maxBuffer:1048576,windowsHide:true}},
   {argv:["serve","--help"],options:{encoding:"utf8",timeout:2000,maxBuffer:1048576,windowsHide:true}},
  ],"Real startup-error catch must exercise both controlled doctor calls");
  assert.equal((await stat(target)).isDirectory(),true);
  assert.equal(await stat(path.join(target,".opencode")).then(()=>true,()=>false),appFiles==="inside");
 }finally{syncMock.mock.restore();asyncMock.mock.restore();syncBuiltinESMExports();await rm(root,{recursive:true,force:true});}
});
