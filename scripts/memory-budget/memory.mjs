// LAWOSS: rozpočet RAM 2 GB (issue #367) – meranie fyzickej pamäte celého
// stromu procesov aplikácie. Čisté funkcie sú tu, aby sa dali testovať bez appky.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** `ps -Ao pid=,ppid=,command=` → záznamy procesov (macOS, Linux). */
export function parseProcessTable(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return rows;
}

/** Koreň, jeho potomkovia a procesy, ktorých príkaz obsahuje niektorú značku (aj osirelé). */
export function selectTree(rows, rootPid, markers = []) {
  const selected = new Set(rows.some((row) => row.pid === rootPid) ? [rootPid] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (selected.has(row.pid)) continue;
      if (selected.has(row.ppid) || markers.some((marker) => marker && row.command.includes(marker))) {
        selected.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => selected.has(row.pid));
}

/** Hodnota stĺpca MEM z macOS `top` (napr. "512K", "1.2M", "2G", "80M+") → MiB. */
export function parseTopMemory(value) {
  const match = String(value).trim().match(/^([\d.]+)([BKMG])?[+-]?$/);
  if (!match) return 0;
  const factor = { B: 1 / 1048576, K: 1 / 1024, M: 1, G: 1024 }[match[2] ?? "B"];
  return Number(match[1]) * factor;
}

/** macOS `top -l 1 -stats pid,mem` → mapa pid → MiB (physical footprint). */
export function parseTopOutput(text) {
  const result = new Map();
  let header = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*PID\s+MEM/.test(line)) { header = true; continue; }
    if (!header) continue;
    const [pid, mem] = line.trim().split(/\s+/);
    if (/^\d+$/.test(pid ?? "")) result.set(Number(pid), parseTopMemory(mem));
  }
  return result;
}

/** Linux `/proc/<pid>/smaps_rollup` → Pss v MiB (zdieľaná pamäť rozpočítaná). */
export function parseSmapsRollup(text) {
  const match = String(text).match(/^Pss:\s+(\d+)\s+kB/m);
  return match ? Number(match[1]) / 1024 : 0;
}

/** Druh procesu pre prehľad (nie pre limit). */
export function processKind(command) {
  const c = command.toLowerCase();
  if (c.includes("lawoss-engine-watchdog")) return "watchdog";
  if (c.includes("--type=gpu")) return "gpu";
  if (c.includes("--type=renderer")) return "renderer";
  if (c.includes("--type=utility")) return "utility";
  if (/sidecars[\\/]opencode/.test(c) || /\bopencode(-[a-z0-9_-]+)?\s+serve\b/.test(c)) return "engine";
  if (/\bnpm(-cli)?\b/.test(c)) return "npm";
  if (c.includes("run.mjs") || c.includes(".cache/lawoss/")) return "mcp";
  if (/(^|[\\/])node(\.exe)?\s/.test(c)) return "node";
  return "main";
}

/** Fyzická pamäť vybraných procesov v MiB podľa platformy. */
export function measureFootprints(pids, platform = process.platform) {
  if (pids.length === 0) return new Map();
  if (platform === "darwin") {
    const args = ["-l", "1", "-stats", "pid,mem"];
    for (const pid of pids) args.push("-pid", String(pid));
    return parseTopOutput(execFileSync("top", args, { encoding: "utf8", timeout: 20_000 }));
  }
  if (platform === "linux") {
    const result = new Map();
    for (const pid of pids) {
      try { result.set(pid, parseSmapsRollup(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"))); }
      catch { /* Process exited. */ }
    }
    return result;
  }
  throw new Error(`Memory budget measurement is not implemented for ${platform}`);
}

export function summarize(samples, budgetMb) {
  const totals = samples.map((sample) => sample.totalMb).sort((a, b) => a - b);
  const pick = (q) => totals.length ? totals[Math.min(totals.length - 1, Math.floor(q * totals.length))] : 0;
  const peak = samples.reduce((best, sample) => (sample.totalMb > (best?.totalMb ?? -1) ? sample : best), null);
  return {
    budgetMb,
    samples: samples.length,
    peakMb: Math.round(peak?.totalMb ?? 0),
    peakAtSeconds: peak?.t ?? null,
    peakByKind: peak?.byKind ?? {},
    medianMb: Math.round(pick(0.5)),
    p95Mb: Math.round(pick(0.95)),
    maxProcesses: Math.max(0, ...samples.map((sample) => sample.processes)),
    withinBudget: (peak?.totalMb ?? 0) <= budgetMb,
  };
}
