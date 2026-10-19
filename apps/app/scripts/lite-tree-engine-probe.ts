#!/usr/bin/env bun
/**
 * Opt-in sonda bočného stromu (rozhovory klienta a vecí) proti SKUTOČNÉMU pripnutému enginu
 * a skutočnému serveru LegalWork. Nie je súčasťou `pnpm test` (potrebuje binárku enginu).
 *
 *   cd apps/app && bun scripts/lite-tree-engine-probe.ts
 *   OPENCODE_BIN=/cesta/k/opencode bun scripts/lite-tree-engine-probe.ts
 *
 * Predvolený engine: sidecar nainštalovanej appky LAWOSS (macOS). Bez binárky skript skončí „SKIP“.
 * Všetko beží v novom dočasnom priečinku: HOME, XDG_* a databázy enginu aj servera sú v ňom,
 * nikdy ~/.config/legalwork ani ~/.config/opencode. Žiadne volanie modelu: konverzácie sa len
 * zakladajú cez proxy priečinka (ako `openMatterSession`) a vypisujú kódom appky.
 *
 * Pokrýva: podstrom klienta cez `path`, podpriečinok veci, podobné meno veci (segmenty),
 * novší klient so 205 konverzáciami (limit), rozložená diakritika v názve priečinka (NFD
 * „Šimková Ľupták“ na disku, NFC v appke), priečinok klienta cez symbolický odkaz, git bez commitu,
 * interné konverzácie posudkov (`legalworkReviewWorker`) a archivované konverzácie.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = process.env.OPENCODE_BIN ?? "/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode";
if (!existsSync(bin)) { console.log(`SKIP: engine binary not found (${bin}); set OPENCODE_BIN`); process.exit(0); }

const root = await mkdtemp(join(tmpdir(), "lawoss-tree-probe-"));
for (const [name, dir] of [["HOME", "home"], ["XDG_CONFIG_HOME", "cfg"], ["XDG_DATA_HOME", "data"], ["XDG_STATE_HOME", "state"], ["XDG_CACHE_HOME", "cache"]] as const) {
  process.env[name] = join(root, dir);
  await mkdir(process.env[name]!, { recursive: true });
}
process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
for (const key of Object.keys(process.env)) if (/^(OPENCODE_|LEGALWORK_(TOKEN|HOST_TOKEN|SERVER))/.test(key) && key !== "LEGALWORK_RUNTIME_DB") delete process.env[key];

const office = join(root, "Kancelaria");
const nfc = "Šimková Ľupták";
const A = join(office, "Klienti", "Alfa s.r.o."), B = join(office, "Klienti", "Beta a.s.");
const N = join(office, "Klienti", nfc.normalize("NFD")); // na disku rozložené
const Napp = join(office, "Klienti", nfc.normalize("NFC")); // appka (cesta z výberu/čítania) zložené
const realG = join(office, "_skutocne", "Gama"), G = join(office, "Klienti", "Gama"); // klient cez symbolický odkaz
const C = join(office, "Klienti", "Delta"); // git bez commitu
const dirs = {
  A, M1: join(A, "Spisy", "Úhrada"), M1sub: join(A, "Spisy", "Úhrada", "Podania"), M1x: join(A, "Spisy", "Úhrada2"),
  M2: join(B, "Spisy", "Nájom"), N, Nm: join(N, "Spisy", "Dedičstvo"), G: realG, Gm: join(realG, "Spisy", "Spor"), C, Cm: join(C, "Spisy", "Zmluva"),
};
for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });
await symlink(realG, G);
Bun.spawnSync(["git", "init", "-q"], { cwd: C, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
await writeFile(join(A, "client.md"), "---\ntitle: Alfa\n---\n");

const { createManagedOpencodeServer } = await import("../../server/src/managed-opencode");
const { startServer } = await import("../../server/src/server");
const mc = await import("../src/lawoss/lite/matter-conversations");

const engine = await createManagedOpencodeServer({ bin, cwd: office, timeoutMs: 60_000 });
const lw = (id: string, path: string) => ({ id, name: id, path, preset: "starter", workspaceType: "local", baseUrl: engine.url, opencodeUsername: engine.username, opencodePassword: engine.password });
const clientWorkspaces = { alfa: A, beta: B, simkova: Napp, gama: G, delta: C };
const server = await startServer({
  host: "127.0.0.1", port: 0, token: "probe", hostToken: "probe-host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
  workspaces: [...Object.entries(clientWorkspaces).map(([id, path]) => lw(id, path)), lw("office", office)],
  authorizedRoots: [office], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
} as never);
const base = `http://127.0.0.1:${server.port}`;
const auth = { Authorization: "Bearer probe", "content-type": "application/json" };

/** Ako `openMatterSession`: cez proxy priečinka, `directory` v tvare appky. */
async function create(ws: string, directory: string, title: string, metadata?: Record<string, unknown>) {
  const response = await fetch(`${base}/workspace/${ws}/opencode/session?directory=${encodeURIComponent(directory)}`, { method: "POST", headers: auth, body: JSON.stringify({ title, ...(metadata ? { metadata } : {}) }) });
  if (!response.ok) throw new Error(`create ${title}: ${response.status} ${await response.text()}`);
  await Bun.sleep(3);
  return (await response.json()) as { id: string; directory: string; path?: string };
}
const app = (path: string) => path.replace(N, Napp).replace(realG, G);
await create("alfa", A, "A-root");
await create("alfa", dirs.M1, "A-M1-1"); await create("alfa", dirs.M1, "A-M1-2");
await create("alfa", dirs.M1sub, "A-M1sub"); await create("alfa", dirs.M1x, "A-M1x");
await create("alfa", A, "Review: zmluva", { legalworkReviewWorker: true });
const archived = await create("alfa", A, "A-archived");
await fetch(`${base}/workspace/alfa/opencode/session/${archived.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ time: { archived: Date.now() } }) });
const nfdSession = await create("simkova", app(dirs.Nm), "N-matter"); await create("simkova", Napp, "N-root");
const gamaSession = await create("gama", app(dirs.Gm), "G-matter"); await create("gama", G, "G-root");
await create("delta", dirs.Cm, "C-matter"); await create("delta", C, "C-root");
for (let i = 0; i < 205; i++) await create("beta", dirs.M2, `B-${i}`);
const form = (text: string) => text === text.normalize("NFC") ? "NFC" : "NFD";
const onDisk = (await readdir(join(office, "Klienti"))).find((name) => name.normalize("NFC") === nfc) ?? "";
console.log("disk/engine:", JSON.stringify({ diskName: form(onDisk), engineDirectory: form(nfdSession.directory), enginePath: form(nfdSession.path ?? ""), symlinkStoredAsRealpath: gamaSession.directory.includes("/_skutocne/"), tmpRealpath: (await realpath(root)) !== root }));

const route = (id: string, path: string) => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" as const });
const conn = { baseUrl: base, token: "probe" };
const owners = {
  clients: Object.entries(clientWorkspaces).map(([key, path]) => ({ key, folder: mc.comparable(path) })),
  matters: [["M1", dirs.M1], ["M1x", dirs.M1x], ["M2", dirs.M2], ["Nm", app(dirs.Nm)], ["Gm", app(dirs.Gm)], ["Cm", dirs.Cm]].map(([path, folder]) => ({ path, folder: mc.comparable(folder) })),
};
const titles = (list?: readonly { title: string | null }[]) => (list ?? []).map((c) => c.title).sort();
async function read(ws: string, folder: string) {
  const engineFor = mc.folderEngine(conn as never, route(ws, ws === "office" ? office : clientWorkspaces[ws as keyof typeof clientWorkspaces]))!;
  const listing = await mc.listFolderSessions(engineFor, ws, folder);
  return { listing, assigned: mc.assignConversations([listing], owners) };
}

const failures: string[] = [];
const expect = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(label);
};
try {
  const alfa = await read("alfa", A);
  expect("alfa klient (bez posudku a archívu)", titles(alfa.assigned.byClient.get("alfa")), ["A-root"]);
  expect("alfa vec s podpriečinkom", titles(alfa.assigned.byMatter.get("M1")), ["A-M1-1", "A-M1-2", "A-M1sub"]);
  expect("alfa podobné meno veci", titles(alfa.assigned.byMatter.get("M1x")), ["A-M1x"]);
  expect("alfa úplný napriek novšej Bete", alfa.listing.complete, true);
  const beta = await read("beta", B);
  expect("beta limit", [beta.listing.items.length, beta.listing.complete], [200, false]);
  const own = await read("beta", dirs.M2);
  expect("beta vec vlastným podstromom tiež limit", own.listing.complete, false);
  const simkova = await read("simkova", Napp);
  expect("NFD klient", titles(simkova.assigned.byClient.get("simkova")), ["N-root"]);
  expect("NFD vec", titles(simkova.assigned.byMatter.get("Nm")), ["N-matter"]);
  expect("NFD podstrom", simkova.listing.subtree, true);
  const gama = await read("gama", G);
  expect("symlink klient", titles(gama.assigned.byClient.get("gama")), ["G-root"]);
  expect("symlink vec", titles(gama.assigned.byMatter.get("Gm")), ["G-matter"]);
  const delta = await read("delta", C);
  expect("git bez commitu: presný výpis klienta", [delta.listing.subtree, titles(delta.assigned.byClient.get("delta"))], [false, ["C-root"]]);
  const deltaMatter = await read("delta", dirs.Cm);
  expect("git bez commitu: vec zvlášť", titles(deltaMatter.assigned.byMatter.get("Cm")), ["C-matter"]);
  const viaOffice = await read("office", A);
  expect("jedna kancelária: klient ako podpriečinok", [titles(viaOffice.assigned.byClient.get("alfa")), titles(viaOffice.assigned.byMatter.get("M1"))], [["A-root"], ["A-M1-1", "A-M1-2", "A-M1sub"]]);
} finally {
  await server.stop();
  await engine.close();
  await rm(root, { recursive: true, force: true });
}
console.log(failures.length ? `FAILED ${failures.length}: ${failures.join("; ")}` : "OK");
process.exit(failures.length ? 1 : 0);
