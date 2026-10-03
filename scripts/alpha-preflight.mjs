import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EXPECTED_NODE_MAJOR = 24;
const EXPECTED_PNPM_VERSION = "11.4.0";
const REQUIRED_FILES = [
  [".nvmrc", ".nvmrc"],
  ["package.json", "package.json"],
  ["build guide", path.join("docs", "lawoss-build-pre-testerov.md")],
];

function versionParts(value) {
  const match = String(value ?? "").trim().match(/^(?:v)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

function detectPnpmVersion() {
  try {
    return execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function addResult(state, name, passed, message, strict) {
  if (passed) {
    state.checks.push({ status: "pass", name, message });
    return;
  }
  const status = strict ? "fail" : "warn";
  state.checks.push({ status, name, message });
  state[status === "fail" ? "errors" : "warnings"].push(`${name}: ${message}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function runPreflight({
  root = process.cwd(),
  nodeVersion = process.version,
  pnpmVersion = detectPnpmVersion(),
  strict = false,
} = {}) {
  const state = { ok: true, checks: [], warnings: [], errors: [] };
  const packagePath = path.join(root, "package.json");
  const packageJson = readJson(packagePath);
  const node = versionParts(nodeVersion);
  const pnpm = versionParts(pnpmVersion);

  addResult(
    state,
    "Node runtime",
    node?.major === EXPECTED_NODE_MAJOR,
    node ? `found Node ${node.major}.${node.minor}.${node.patch}; full builds require Node 24` : "could not parse the Node version",
    strict,
  );

  addResult(
    state,
    "pnpm runtime",
    pnpmVersion === EXPECTED_PNPM_VERSION,
    pnpm ? `found pnpm ${pnpm.major}.${pnpm.minor}.${pnpm.patch}; repository requires pnpm ${EXPECTED_PNPM_VERSION}` : `pnpm ${EXPECTED_PNPM_VERSION} was not detected`,
    strict,
  );

  for (const [label, relativePath] of REQUIRED_FILES) {
    const present = existsSync(path.join(root, relativePath));
    addResult(
      state,
      `Required ${label}`,
      present,
      present ? `${relativePath} is present` : `missing ${relativePath}`,
      strict,
    );
  }

  addResult(
    state,
    "package metadata",
    packageJson !== null,
    packageJson === null ? "package.json is missing or invalid JSON" : "package.json is valid JSON",
    strict,
  );

  if (packageJson) {
    const packageManager = packageJson.packageManager;
    addResult(
      state,
      "packageManager",
      packageManager === `pnpm@${EXPECTED_PNPM_VERSION}`,
      `repository declares ${packageManager ?? "no packageManager"}; expected pnpm@${EXPECTED_PNPM_VERSION}`,
      strict,
    );

    const nodeRange = packageJson.engines?.node;
    addResult(
      state,
      "Node engines range",
      nodeRange === ">=24.0.0 <25.0.0",
      `repository declares ${nodeRange ?? "no Node engines range"}; expected >=24.0.0 <25.0.0`,
      strict,
    );
  }

  const nvmrcPath = path.join(root, ".nvmrc");
  const nvmrc = existsSync(nvmrcPath) ? readFileSync(nvmrcPath, "utf8").trim() : "";
  addResult(
    state,
    ".nvmrc runtime",
    /^24(?:\.|$)/.test(nvmrc),
    `repository selects ${nvmrc || "no runtime"}; expected Node 24`,
    strict,
  );

  state.ok = state.errors.length === 0;
  return state;
}

export function renderPreflight(result) {
  const lines = ["LAWOSS alpha preflight — no provider or workspace data was accessed"];
  for (const check of result.checks) {
    const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    lines.push(`[${marker}] ${check.name}: ${check.message}`);
  }
  const resultLine = result.errors.length > 0
    ? "Result: NOT READY FOR THE CHECKED SCOPE"
    : result.warnings.length > 0
      ? "Result: READY WITH WARNINGS — USE STRICT MODE BEFORE CONTINUING"
      : "Result: READY FOR THE CHECKED SCOPE";
  lines.push(resultLine);
  lines.push("This is a technical preflight, not legal, security or production approval.");
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { strict: false, root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--strict") {
      options.strict = true;
    } else if (argument === "--root") {
      const next = argv[index + 1];
      if (!next) throw new Error("--root requires a path");
      options.root = path.resolve(next);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runPreflight(parseArgs(process.argv.slice(2)));
    console.log(renderPreflight(result));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
