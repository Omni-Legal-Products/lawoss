/**
 * Načítanie pamäte spisov cez server API — iba čítanie, nič nezapisuje.
 *
 * Prejde `AK/<písmeno>/<klient>/Spisy/<vec>`, z každej veci prečíta kartu
 * `spis.md` a záznamy `memory/*.md` (okrem `index.md` a `log.md`), rozparsuje
 * ich cez `parseRecord` a zloží prehľad cez `buildOverview`. Poškodený súbor
 * nezhodí celé čítanie — skončí v `problems` a zvyšok sa spracuje.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";

import { addDays, buildOverview, deadlineTier, type DeadlineTier, type MatterInput, type Overview } from "../../../../../lawoss/okf/read";
import { parseFrontmatter, today } from "../../../../../lawoss/okf/src/core";
import { parseRecord } from "../../../../../lawoss/okf-pamat/src/record.ts";
import { loadOkfConnection, type OkfConnection } from "./connection";

export type OkfReadClient = Pick<LegalworkServerClient, "listWorkspaceDirectory" | "readWorkspaceFile">;
export type ReadProblem = { path: string; message: string };
export type OkfReadResult = Overview & {
  problems: ReadProblem[];
  /** Workspace má viac vecí než `MAX_MATTERS`; prehľad je čiastočný. */
  truncated: boolean;
};

export const MAX_MATTERS = 200;
const CONCURRENCY = 6;
const ROOT = "AK";
const MATTERS_DIR = "Spisy";
const MEMORY_DIR = "memory";
const CARD_FILE = "spis.md";
const RESERVED = new Set(["index.md", "log.md"]);

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `Promise.all` s hornou hranicou súbežnosti; výsledky v poradí vstupu. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function subdirs(client: OkfReadClient, workspaceId: string, path: string): Promise<string[]> {
  const list = await client.listWorkspaceDirectory(workspaceId, path);
  return list.entries.filter((e) => e.kind === "dir" && !e.name.startsWith(".")).map((e) => e.path);
}

/** Cesty vecí `AK/<písmeno>/<klient>/Spisy/<vec>`; `Office/` a skryté priečinky sa nečítajú. */
async function findMatters(client: OkfReadClient, workspaceId: string): Promise<{ paths: string[]; truncated: boolean }> {
  let root: string[];
  try {
    root = await subdirs(client, workspaceId, ROOT);
  } catch {
    return { paths: [], truncated: false }; // workspace bez AK/ — žiadne spisy, nie chyba
  }
  const clients = (await mapLimit(root, CONCURRENCY, (p) => subdirs(client, workspaceId, p).catch(() => []))).flat();
  const matters = (
    await mapLimit(clients, CONCURRENCY, (p) => subdirs(client, workspaceId, `${p}/${MATTERS_DIR}`).catch(() => []))
  ).flat();
  return { paths: matters.slice(0, MAX_MATTERS), truncated: matters.length > MAX_MATTERS };
}

async function readMatter(
  client: OkfReadClient,
  workspaceId: string,
  path: string,
  problems: ReadProblem[],
): Promise<MatterInput> {
  const input: MatterInput = { path, records: [] };
  const entries = (await client.listWorkspaceDirectory(workspaceId, path)).entries;
  if (entries.some((e) => e.kind === "file" && e.name === CARD_FILE)) {
    const cardPath = `${path}/${CARD_FILE}`;
    try {
      const fm = parseFrontmatter((await client.readWorkspaceFile(workspaceId, cardPath)).content);
      if (fm) input.cardFrontmatter = fm;
    } catch (e) {
      problems.push({ path: cardPath, message: message(e) });
    }
  }
  if (!entries.some((e) => e.kind === "dir" && e.name === MEMORY_DIR)) return input;
  const files = (await client.listWorkspaceDirectory(workspaceId, `${path}/${MEMORY_DIR}`)).entries
    .filter((e) => e.kind === "file" && e.name.endsWith(".md") && !RESERVED.has(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Súbory jednej veci sa čítajú za sebou; súbežnosť drží `mapLimit` nad vecami.
  for (const file of files) {
    try {
      input.records.push(parseRecord((await client.readWorkspaceFile(workspaceId, file.path)).content));
    } catch (e) {
      problems.push({ path: file.path, message: message(e) });
    }
  }
  return input;
}

export async function readWorkspaceMemory(
  client: OkfReadClient,
  workspaceId: string,
  todayIso: string = today(),
): Promise<OkfReadResult> {
  const problems: ReadProblem[] = [];
  const { paths, truncated } = await findMatters(client, workspaceId);
  const matters = await mapLimit(paths, CONCURRENCY, (p) => readMatter(client, workspaceId, p, problems));
  return { ...buildOverview(matters, todayIso), problems, truncated };
}

/** Spojenie na server rovnako ako v Novom spise, len ako hook. */
export function useOkfConnection(): { connection: OkfConnection | null; error: string | null } {
  const [connection, setConnection] = useState<OkfConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadOkfConnection()
      .then((next) => { if (!cancelled) setConnection(next); })
      .catch((e: unknown) => { if (!cancelled) setError(message(e)); });
    return () => { cancelled = true; };
  }, []);
  return { connection, error };
}

export function activeWorkspace(connection: OkfConnection | null): RouteWorkspace | null {
  if (!connection) return null;
  return connection.workspaces.find((w) => w.id === connection.activeWorkspaceId) ?? connection.workspaces[0] ?? null;
}

export function useOkfOverview(connection: OkfConnection | null, workspace: RouteWorkspace | null) {
  const client = connection?.client ?? null;
  return useQuery({
    queryKey: ["okf-overview", workspace?.id ?? ""],
    enabled: Boolean(client && workspace),
    queryFn: () => {
      if (!client || !workspace) throw new Error("Server LegalWork nebeží alebo chýba workspace.");
      return readWorkspaceMemory(client, workspace.id);
    },
  });
}

// ── zobrazenie ────────────────────────────────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayFormat = new Intl.DateTimeFormat("sk-SK", { weekday: "short", day: "numeric", month: "numeric" });
const longFormat = new Intl.DateTimeFormat("sk-SK", { weekday: "long", day: "numeric", month: "long" });

/** `2026-09-12` → „so 12. 9."; nevalidný dátum sa vypíše, ako je zapísaný. */
export function formatDay(iso: string): string {
  return ISO_DAY.test(iso) ? dayFormat.format(new Date(`${iso}T00:00:00`)) : iso;
}

/** `2026-09-12` → „Sobota 12. septembra". */
export function formatLongDay(iso: string): string {
  if (!ISO_DAY.test(iso)) return iso;
  const s = longFormat.format(new Date(`${iso}T00:00:00`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Trieda `lw-d` podľa blízkosti termínu. */
export function dayClass(date: string, todayIso: string): string {
  const tier: DeadlineTier = deadlineTier(date, todayIso);
  return tier === "overdue" || tier === "today" ? "lw-d urg" : tier === "soon" ? "lw-d soon" : "lw-d";
}

export { addDays, today };
