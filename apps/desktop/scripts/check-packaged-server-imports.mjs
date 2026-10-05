/**
 * LAWOSS: overí, že sa každý modul servera dá načítať v rozložení zabalenej appky.
 *
 * Electron načíta server priamo z `Resources/app.asar/server/dist`. Relatívny import,
 * ktorý v repozitári vedie mimo `apps/server/dist` (napríklad do koreňového
 * `lawoss/`), tam ukazuje do `Resources/` a appka po štarte hlási
 * `ERR_MODULE_NOT_FOUND` a „LegalWork server did not finish starting“. Vývoj aj
 * testy servera ostanú zelené, lebo čítajú repozitár. Tak sa do alfy dostal
 * `lawoss/chatgpt-subscription.js` (PR #113), ktorý tsc skompiloval bez bundlu.
 *
 * Použitie:
 *   node check-packaged-server-imports.mjs                     # apps/desktop/server (po electron-build)
 *   node check-packaged-server-imports.mjs <apps/server/dist>  # hneď po `pnpm --filter legalwork-server build`
 *   node check-packaged-server-imports.mjs <priečinok so server/dist>
 *   node check-packaged-server-imports.mjs <.../resources/app.asar>  # zabalená appka, beží v Electrone
 *
 * Priečinky sa skopírujú do dočasného `Resources/app` (node_modules z apps/desktop,
 * ako v asar archíve), takže únik mimo stromu nič nenájde ani v checkoute. Každý
 * `server/dist/**\/*.js` okrem testov, pluginov enginu (v asar nie sú, stráži ich
 * check-plugin-bundles.mjs) a vstupných skriptov s vedľajšími účinkami sa importuje
 * v samostatnom procese s izolovaným HOME a XDG_*. Relatívne importy všetkých
 * súborov sa navyše overia staticky, aj tých, ktoré sa nespúšťajú.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");

/** Vstupné skripty, ktoré po importe spustia server alebo UI; overujú sa len staticky. */
export const ENTRY_POINTS = new Set(["cli.js", "toy-ui.js"]);

/** Súbory, ktoré electron-builder z `server/dist` do asar archívu nedá alebo ktoré sa nemajú spúšťať. */
export function isImportable(relativePath) {
  const path = relativePath.split(sep).join("/");
  if (!path.endsWith(".js") || path.endsWith(".test.js")) return false;
  if (path.startsWith("opencode-plugins/")) return false;
  return !ENTRY_POINTS.has(path);
}

/** Statické `import`/`export ... from` a `import "x"` na začiatku riadku; reťazce v kóde nevadia. */
const RELATIVE_IMPORT =
  /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])(\.{1,2}\/[^"']+)\1|^[ \t]*import\s*(["'])(\.{1,2}\/[^"']+)\3/gm;

export function relativeSpecifiers(source) {
  return [...source.matchAll(RELATIVE_IMPORT)].map((match) => match[2] ?? match[4]);
}

function listJs(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listJs(path, base, out);
    else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) out.push(relative(base, path));
  }
  return out.sort();
}

/** Beží v detskom procese (Node alebo Electron ako Node), `appRoot` je `Resources/app` alebo `app.asar`. */
async function worker(appRoot, resultFile) {
  const dist = join(appRoot, "server", "dist");
  const failures = [];
  // Pluginy enginu v asar nie sú (electron-builder ich dáva do Resources/opencode-plugins).
  const files = listJs(dist).filter((file) => file.split(sep)[0] !== "opencode-plugins");
  for (const file of files) {
    const path = join(dist, file);
    for (const specifier of relativeSpecifiers(readFileSync(path, "utf8"))) {
      if (!existsSync(resolve(dirname(path), specifier))) {
        failures.push({ file, code: "ERR_MODULE_NOT_FOUND", message: `static import "${specifier}" does not exist in the packaged tree (${resolve(dirname(path), specifier)})` });
      }
    }
  }
  const imported = files.filter(isImportable);
  for (const file of imported) {
    try {
      await import(pathToFileURL(join(dist, file)).href);
    } catch (error) {
      failures.push({ file, code: error?.code ?? error?.name ?? "Error", message: String(error?.message ?? error).split("\n")[0] });
    }
  }
  // Cesty v hláseniach od priečinka `Resources/`, nech je vidno, kam import mieri.
  const resources = [realpathSync(dirname(appRoot)), dirname(appRoot)];
  const short = (text) => resources.reduce((acc, prefix) => acc.split(prefix).join("Resources"), text);
  const reported = failures.map((failure) => ({ ...failure, message: short(failure.message) }));
  writeFileSync(resultFile, JSON.stringify({ files: files.length, imported: imported.length, failures: reported }));
  process.exit(0);
}

/** Pripraví `Resources/app` v dočasnom priečinku tak, ako ho poskladá electron-build.mjs a electron-builder. */
function stage(target, temp) {
  const app = join(temp, "Resources", "app");
  mkdirSync(join(app, "server"), { recursive: true });
  if (existsSync(join(target, "server", "dist"))) {
    cpSync(join(target, "server"), join(app, "server"), { recursive: true });
  } else if (existsSync(join(target, "server.js"))) {
    // Surový výstup `pnpm --filter legalwork-server build`: rovnaké dva kroky ako electron-build.mjs.
    const dist = join(app, "server", "dist");
    cpSync(target, dist, { recursive: true });
    cpSync(join(repoRoot, "constants.json"), join(dist, "constants.json"));
    const serverJs = join(dist, "server.js");
    writeFileSync(serverJs, readFileSync(serverJs, "utf8").replace(/from\s+["']\.\.\/\.\.\/\.\.\/constants\.json["']/, 'from "./constants.json"'));
    cpSync(join(repoRoot, "apps", "server", "package.json"), join(app, "server", "package.json"));
  } else {
    throw new Error(`${target} is neither server/dist output nor a directory containing server/dist`);
  }
  cpSync(join(desktopRoot, "package.json"), join(app, "package.json"));
  symlinkSync(join(desktopRoot, "node_modules"), join(app, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  return app;
}

function isolatedEnv(temp) {
  const home = join(temp, "home");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(LEGALWORK_|OPENCODE_|EIGENWELT_)/.test(key)) delete env[key];
  Object.assign(env, {
    HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(temp, "xdg", "config"), XDG_DATA_HOME: join(temp, "xdg", "data"),
    XDG_STATE_HOME: join(temp, "xdg", "state"), XDG_CACHE_HOME: join(temp, "xdg", "cache"),
    LEGALWORK_DATA_DIR: join(temp, "runtime"), LEGALWORK_ELECTRON_USERDATA: join(temp, "userdata"),
    NODE_OPTIONS: "",
  });
  mkdirSync(home, { recursive: true });
  return env;
}

export function checkPackagedServerImports(target = desktopRoot, { timeoutMs = 180_000 } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "lawoss-packaged-imports-"));
  try {
    const asar = statSync(target).isFile() && target.endsWith(".asar");
    const appRoot = asar ? resolve(target) : stage(resolve(target), temp);
    const resultFile = join(temp, "result.json");
    const env = isolatedEnv(temp);
    // Zabalená appka má natívne moduly pre ABI Electronu a asar číta len Electron.
    const command = asar ? createRequire(join(desktopRoot, "package.json"))("electron") : process.execPath;
    if (asar) env.ELECTRON_RUN_AS_NODE = "1";
    const child = spawnSync(command, [fileURLToPath(import.meta.url), "--worker", appRoot, resultFile], {
      cwd: temp, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
    });
    if (!existsSync(resultFile)) {
      throw new Error(`import worker did not finish (status ${child.status}, signal ${child.signal})\n${child.stdout}\n${child.stderr}`);
    }
    return JSON.parse(readFileSync(resultFile, "utf8"));
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[2] === "--worker") {
  await worker(process.argv[3], process.argv[4]);
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] ? resolve(process.argv[2]) : desktopRoot;
  const { files, imported, failures } = checkPackagedServerImports(target);
  if (failures.length > 0) {
    console.error(`Packaged server modules fail to load (${failures.length}) in ${target}:`);
    for (const { file, code, message } of failures) console.error(`- server/dist/${file.split(sep).join("/")}: [${code}] ${message}`);
    console.error("Bundle modules that import from outside apps/server (for example the root lawoss/) with `bun build` in apps/server/package.json.");
    process.exit(1);
  }
  console.log(`Packaged server modules load: ${imported} imported, ${files} statically checked (${target}).`);
}
