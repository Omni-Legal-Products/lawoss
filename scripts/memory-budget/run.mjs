#!/usr/bin/env node
// LAWOSS: brána rozpočtu RAM 2 GB (issue #367).
//
// Spustí zabalenú aplikáciu s izolovaným profilom a syntetickými klientmi
// (SYNTHETIC_DATA.md), nainštaluje balík LAWOSS Marketplace cez rovnaké API
// ako okno, postupne otvorí niekoľko klientov a každé ~2 s zmeria fyzickú
// pamäť celého stromu procesov (macOS physical footprint, Linux PSS).
// Skončí chybou, keď špička prekročí rozpočet alebo po ukončení ostanú siroty.
//
//   node scripts/memory-budget/run.mjs --app <executable> --dataset <LAWOSS-SK-synthetic-v1>
//     [--marketplace-repo <git checkout lawoss-marketplace>] [--marketplace-ref <sha>] [--bundle sk-zaklad]
//     [--clients 10] [--open 4] [--open-every 40] [--settle 30] [--budget-mb 2048] [--out <dir>]
//
// Sieť: bez --marketplace-repo sa balík neinštaluje. S ním sa súbory pluginov
// čítajú z lokálneho checkoutu (zrkadlo GitHub API), npm z registra.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { measureFootprints, parseProcessTable, processKind, selectTree, summarize } from "./memory.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : fallback; };
const app = arg("--app");
const dataset = arg("--dataset");
if (!app || !dataset) {
  process.stderr.write("Usage: run.mjs --app <packaged executable> --dataset <LAWOSS-SK-synthetic-v1> [options]\n");
  process.exit(2);
}
const options = {
  marketplaceRepo: arg("--marketplace-repo", ""),
  // Iný commit Marketplace než snapshot (overenie PR v lawoss-marketplace).
  marketplaceRef: arg("--marketplace-ref", ""),
  bundle: arg("--bundle", "sk-zaklad"),
  clients: Number(arg("--clients", "10")),
  open: Number(arg("--open", "4")),
  openEvery: Number(arg("--open-every", "40")),
  settle: Number(arg("--settle", "30")),
  budgetMb: Number(arg("--budget-mb", "2048")),
  out: resolve(arg("--out", join(repoRoot, ".work", "memory-budget"))),
};
const executable = realpathSync(app);
const t0 = Date.now();
const seconds = () => Math.round((Date.now() - t0) / 100) / 10;
const log = (message) => process.stdout.write(`[memory-budget ${seconds()}s] ${message}\n`);

// --- izolovaný profil so syntetickými klientmi -------------------------------
const root = realpathSync(mkdtempSync(join(tmpdir(), "lawoss-memory-budget-")));
const dirs = Object.fromEntries(["userdata", "runtime", "home", "config", "data", "cache"].map((name) => {
  const path = join(root, name);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return [name, path];
}));
const office = join(root, "office");
cpSync(join(dataset, "02_OKF_kancelaria"), office, { recursive: true });
const clientNames = readdirSync(join(office, "Klienti")).sort().slice(0, options.clients);
const clientPaths = clientNames.map((name) => join(office, "Klienti", name));
const workspaceId = (path) => `ws_${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
const home = join(dirs.userdata, "lawoss-domov");
mkdirSync(home, { recursive: true });
// Register ako po onboardingu (apps/desktop/electron/workspace-store.mjs): domov + klienti.
const entry = (path, name) => ({ id: workspaceId(path), name, path, preset: "starter", workspaceType: "local", remoteType: null, baseUrl: null, directory: null,
  displayName: name, appFiles: "outside", legalworkHostUrl: null, legalworkToken: null, legalworkClientToken: null, legalworkHostToken: null,
  legalworkWorkspaceId: null, legalworkWorkspaceName: null, sandboxBackend: null, sandboxRunId: null, sandboxContainerName: null });
const registry = [entry(home, "LAWOSS"), ...clientPaths.map((path, index) => entry(path, clientNames[index]))];
writeFileSync(join(dirs.userdata, "legalwork-workspaces.json"), JSON.stringify({ recoveryCompleted: true, selectedId: registry[0].id,
  watchedId: registry[0].id, activeId: registry[0].id, workspaces: registry, selectedWorkspaceId: registry[0].id }, null, 2));

// --- lokálne zrkadlo GitHub API pre LAWOSS Marketplace ------------------------
let mirror = null;
if (options.marketplaceRepo) {
  const git = (...args) => execFileSync("git", ["-C", options.marketplaceRepo, ...args], { maxBuffer: 256 * 1024 * 1024 });
  mirror = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const send = (status, body, type = "application/json") => { response.writeHead(status, { "content-type": type }); response.end(body); };
    try {
      const tree = url.pathname.match(/^\/api\/repos\/[^/]+\/[^/]+\/git\/trees\/([0-9a-f]{40})$/);
      if (tree) {
        const rows = git("ls-tree", "-r", "--full-tree", tree[1]).toString().split("\n").filter(Boolean).map((line) => {
          const [meta, path] = line.split("\t");
          const [mode, type, sha] = meta.split(" ");
          return { path, mode, type, sha };
        });
        return send(200, JSON.stringify({ sha: tree[1], tree: rows, truncated: false }));
      }
      if (/^\/api\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) return send(200, JSON.stringify({ default_branch: "main" }));
      const raw = url.pathname.match(/^\/raw\/[^/]+\/[^/]+\/([0-9a-f]{40})\/(.+)$/);
      if (raw) return send(200, git("show", `${raw[1]}:${decodeURIComponent(raw[2])}`), "application/octet-stream");
      return send(404, JSON.stringify({ message: "Not Found" }));
    } catch {
      return send(404, JSON.stringify({ message: "Not Found" }));
    }
  });
  await new Promise((resolveListen) => mirror.listen(0, "127.0.0.1", resolveListen));
}
const mirrorBase = mirror ? `http://127.0.0.1:${mirror.address().port}` : null;

// --- spustenie aplikácie -----------------------------------------------------
const inherited = Object.fromEntries(["PATH", "TMPDIR", "LANG", "TERM", "USER", "LOGNAME", "DISPLAY", "XAUTHORITY"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
const env = {
  ...inherited, HOME: dirs.home, XDG_CONFIG_HOME: dirs.config, XDG_DATA_HOME: dirs.data, XDG_CACHE_HOME: dirs.cache,
  NODE_OPTIONS: "", ELECTRON_RUN_AS_NODE: "", LEGALWORK_DEV_MODE: "0", LEGALWORK_ELECTRON_USERDATA: dirs.userdata,
  LEGALWORK_DATA_DIR: dirs.runtime, LEGALWORK_SERVER_CONFIG: join(dirs.runtime, "server.json"), LEGALWORK_RUNTIME_DB: join(dirs.runtime, "runtime.db"),
  OPENCODE_DB: join(dirs.runtime, "opencode.db"), LEGALWORK_WORKSPACES: JSON.stringify(clientPaths), LEGALWORK_WORD_ADDIN: "0",
  ...(mirrorBase ? { LEGALWORK_GITHUB_API_BASE: `${mirrorBase}/api`, LEGALWORK_GITHUB_RAW_BASE: `${mirrorBase}/raw` } : {}),
};
const launchArgs = process.platform === "darwin" ? ["--use-mock-keychain"] : process.platform === "linux" ? ["--no-sandbox"] : [];
const child = spawn(executable, launchArgs, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-200_000); });
child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-200_000); });
const bundleRoot = process.platform === "darwin" ? executable.replace(/\/Contents\/MacOS\/[^/]+$/, "") : dirname(executable);
const markers = [bundleRoot, root];
log(`started pid=${child.pid}, ${clientPaths.length} synthetic clients`);

const samples = [];
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    try {
      const rows = selectTree(parseProcessTable(execFileSync("ps", ["-Ao", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })), child.pid, markers);
      const footprints = measureFootprints(rows.map((row) => row.pid));
      const byKind = {};
      for (const row of rows) byKind[processKind(row.command)] = Math.round((byKind[processKind(row.command)] ?? 0) + (footprints.get(row.pid) ?? 0));
      samples.push({ t: seconds(), processes: rows.length, totalMb: rows.reduce((sum, row) => sum + (footprints.get(row.pid) ?? 0), 0), byKind });
    } catch { /* A process exited between ps and the measurement. */ }
    await delay(2000);
  }
})();

const userFile = (name) => JSON.parse(readFileSync(join(dirs.userdata, name), "utf8"));
async function waitFor(label, budgetMs, probe) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`application exited before ${label}`);
    const value = await probe().catch(() => null);
    if (value) return value;
    await delay(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

let failure = null;
let phase = "ready";
try {
  const discovery = await waitFor("UI readiness", 180_000, async () => {
    const value = userFile("legalwork-ui-control.json");
    const snapshot = await fetch(`${value.baseUrl}/snapshot`, { headers: { authorization: `Bearer ${value.token}` }, signal: AbortSignal.timeout(10_000) });
    return snapshot.ok && (await snapshot.json()).ok ? value : null;
  });
  log(`UI ready (${discovery.baseUrl})`);
  phase = "server";
  const server = await waitFor("embedded server", 120_000, async () => {
    const tokens = Object.values(userFile("legalwork-server-tokens.json").workspaces)[0];
    for (const port of Object.values(userFile("legalwork-server-state.json").workspacePorts)) {
      const response = await fetch(`http://127.0.0.1:${port}/workspaces`, { headers: { authorization: `Bearer ${tokens.clientToken}` } }).catch(() => null);
      if (response?.ok) return { base: `http://127.0.0.1:${port}`, client: tokens.clientToken, host: tokens.hostToken, list: await response.json() };
    }
    return null;
  });

  phase = "marketplace";
  if (mirrorBase) {
    const snapshot = JSON.parse(readFileSync(join(repoRoot, "apps/app/src/lawoss/domains/marketplace/marketplace-snapshot.json"), "utf8"));
    const bundle = snapshot.bundles.find((candidate) => candidate.id === options.bundle);
    if (!bundle) throw new Error(`unknown Marketplace bundle ${options.bundle}`);
    for (const name of bundle.plugins) {
      const plugin = snapshot.plugins.find((candidate) => candidate.name === name);
      const response = await fetch(`${server.base}/lawoss/marketplace/plugins`, {
        method: "POST", headers: { "x-legalwork-host-token": server.host, "content-type": "application/json" },
        body: JSON.stringify({ url: `https://github.com/${snapshot.repository}/tree/${options.marketplaceRef || plugin.ref}/${plugin.path}` }), signal: AbortSignal.timeout(300_000),
      });
      const body = await response.text();
      if (!response.ok || !body.includes("\"installed\"")) throw new Error(`Marketplace install ${name} failed: ${response.status} ${body.slice(0, 300)}`);
      log(`installed ${name}`);
    }
  }

  phase = "open";
  // Otvorenie klienta = rovnaká požiadavka ako okno chatu (zoznam príkazov spustí jeho MCP).
  const ids = server.list.items.filter((workspace) => clientPaths.includes(workspace.path)).map((workspace) => workspace.id);
  for (const id of [...ids.slice(0, options.open), ...(ids.length ? [ids[0]] : [])]) {
    const started = Date.now();
    const response = await fetch(`${server.base}/workspace/${id}/opencode/command`, { headers: { authorization: `Bearer ${server.client}` }, signal: AbortSignal.timeout(600_000) });
    await response.arrayBuffer();
    log(`opened client ${id}: HTTP ${response.status} in ${Date.now() - started} ms`);
    if (!response.ok) throw new Error(`opening client ${id} failed with HTTP ${response.status}`);
    await delay(options.openEvery * 1000);
  }
  phase = "settle";
  await delay(options.settle * 1000);
  phase = "done";
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  log(`scenario failed in phase ${phase}: ${failure}`);
}

// --- ukončenie, siroty, výsledok ---------------------------------------------
try { process.kill(child.pid, "SIGTERM"); } catch { /* gone */ }
for (let waited = 0; waited < 30_000 && child.exitCode === null && child.signalCode === null; waited += 200) await delay(200);
sampling = false;
await sampler;
await delay(5000);
const orphans = parseProcessTable(execFileSync("ps", ["-Ao", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))
  .filter((row) => markers.some((marker) => row.command.includes(marker)) && row.pid !== process.pid);
for (const orphan of orphans) { try { process.kill(orphan.pid, "SIGKILL"); } catch { /* gone */ } }
try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
mirror?.close();

const result = { ...summarize(samples.filter((sample) => sample.totalMb > 50), options.budgetMb), orphansAfterQuit: orphans.length,
  scenario: { clients: clientPaths.length, bundle: mirrorBase ? options.bundle : null, opened: options.open, platform: `${process.platform}-${process.arch}` },
  // Artefakt nesie len čísla a fázu (AGENTS.md: žiadne surové chyby, cesty ani telá odpovedí).
  failedPhase: failure ? phase : null };
mkdirSync(options.out, { recursive: true });
writeFileSync(join(options.out, "memory-budget.json"), JSON.stringify({ result, samples }, null, 2));
writeFileSync(join(options.out, "app-output.log"), output);
const summaryLines = [
  `### Rozpočet RAM ${options.budgetMb} MB (#367)`, "",
  `| Scenár | Procesov (max) | Medián | p95 | Špička | Siroty |`, `|---|---|---|---|---|---|`,
  `| ${result.scenario.clients} klientov, ${result.scenario.bundle ?? "bez Marketplace"}, ${options.open} otvorení | ${result.maxProcesses} | ${result.medianMb} MB | ${result.p95Mb} MB | **${result.peakMb} MB** (t=${result.peakAtSeconds}s) | ${result.orphansAfterQuit} |`,
  "", `Špička podľa druhu procesu: ${Object.entries(result.peakByKind).map(([kind, mb]) => `${kind} ${mb} MB`).join(", ")}`,
  ...(failure ? ["", `**Scenár zlyhal vo fáze \`${phase}\`** (podrobnosti v logu kroku).`] : []), "",
];
writeFileSync(join(options.out, "summary.md"), summaryLines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join("\n"), { flag: "a" });
process.stdout.write(summaryLines.join("\n"));
rmSync(root, { recursive: true, force: true });
if (failure || !result.withinBudget || result.orphansAfterQuit > 0) process.exit(1);
