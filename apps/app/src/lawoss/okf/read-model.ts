/**
 * Načítanie pamäte spisov cez server API — iba čítanie, nič nezapisuje.
 *
 * Objaví veci podľa kariet v pracovnom priečinku a z každej načíta kanonickú alebo staršiu kartu
 * a pamäť veci, klienta aj kancelárie (okrem index.md a log.md), rozparsuje
 * ich cez `parseRecord` a zloží prehľad cez `buildOverview`. Poškodený súbor
 * nezhodí celé čítanie — skončí v `problems` a zvyšok sa spracuje.
 */
import { readManualStatus } from "../../../../../lawoss/okf-pamat/src/manual-status.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { normalizeDirectoryPath } from "@/app/utils";

import { addDays, buildOverview, deadlineTier, type DeadlineTier, type MatterInput, type Overview } from "../../../../../lawoss/okf/read";
import { parseFrontmatter } from "../../../../../lawoss/okf/src/core";
import { parseRecord, parseFrontmatter as parseMemoryFrontmatter } from "../../../../../lawoss/okf-pamat/src/record.ts";
import { validateStore } from "../../../../../lawoss/okf-pamat/src/validate.ts";
import { loadOkfConnection, type OkfConnection } from "./connection";

export type OkfReadClient = Pick<LegalworkServerClient, "listWorkspaceDirectory" | "readWorkspaceFile">;
export type ReadProblem = { path: string; message: string; kind?: "validation"; scope?: "matter" | "client" | "office" };
export type OkfReadResult = Overview & {
  problems: ReadProblem[];
  /** Workspace má viac vecí než `MAX_MATTERS`; prehľad je čiastočný. */
  truncated: boolean;
  /** Prečítané záznamy po veciach — detail veci ich potrebuje, prehľad ich ignoruje. */
  inputs: MatterInput[];
  /** Priečinky s kartou klienta (`client.md`/`klient.md`) vrátane klientov bez vecí; názov z karty. */
  clients?: OkfClient[];
};
export type OkfClient = { path: string; title?: string };

export const MAX_MATTERS = 200;
const CONCURRENCY = 6;
export const MAX_DISCOVERY_DIRECTORIES = 1000;
const MAX_DISCOVERY_DEPTH = 16;
const SKIP_DIRECTORIES = new Set(["memory", "Office", "_kancelaria", "node_modules", "vendor", "dist", "build", "target", "coverage"]);
const childPath = (dir: string, name: string): string => dir ? `${dir}/${name}` : name;
const MATTERS_DIR = "Spisy";
const MEMORY_DIR = "memory";
const CARD_FILES = ["matter.md", "spis.md", "project.md", "projekt.md"];
const CLIENT_CARDS = ["client.md", "klient.md"];
/** Klient ve tvaru kanceláře `AK/<písmeno>/<klient>` (vault bez karet a bez `Spisy/`). */
const AK_CLIENT = /^AK\/[^/]+\/[^/]+$/;
/** Pracovní podsložky uvnitř klienta nebo věci - nejsou to samostatné věci. */
const WORK_DIRS = new Set(["DS", "Prilohy", "Přílohy", "research", "drafts", "final", "analysis", "sources", "qa", "logs"]);
const isWorkDir = (name: string): boolean => WORK_DIRS.has(name) || /^\d{2}_/.test(name) || name.startsWith("_");
const RESERVED = new Set(["index.md", "log.md", "INDEX.md"]);
const missing = (e: unknown): boolean => /(?:\b404\b|\bENOENT\b|not found)/i.test(message(e));
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

/** Bounded discovery and complete shared scope; every failed read remains visible. */
export async function readWorkspaceMemory(
  client: OkfReadClient,
  workspaceId: string,
  todayIso: string = today(),
): Promise<OkfReadResult> {
  const problems: ReadProblem[] = [];
  let truncated = false;
  type Listing = Awaited<ReturnType<OkfReadClient["listWorkspaceDirectory"]>>;
  const cache = new Map<string, Promise<Listing["entries"]>>();
  const list = (path: string, optional = false): Promise<Listing["entries"]> => {
    let pending = cache.get(path);
    if (!pending) {
      pending = client.listWorkspaceDirectory(workspaceId, path).then((result) => {
        if (result.truncated) {
          truncated = true;
          problems.push({ path, message: "Neúplný výpis priečinka zo servera." });
        }
        return result.entries;
      }).catch((e: unknown) => {
        if (!optional || !missing(e)) problems.push({ path, message: message(e) });
        return [];
      });
      cache.set(path, pending);
    }
    return pending;
  };
  const dirs = async (path: string): Promise<string[]> => (await list(path))
    .filter((e) => e.kind === "dir" && !e.name.startsWith(".") && !SKIP_DIRECTORIES.has(e.name)).map((e) => e.path);
  const paths: string[] = [];
  const clientPaths: string[] = [];
  let scanned = 0;
  const discover = async (path: string, directMatter = false, depth = 0, insideClient = false): Promise<void> => {
    if (scanned >= MAX_DISCOVERY_DIRECTORIES || paths.length >= MAX_MATTERS || depth > MAX_DISCOVERY_DEPTH) { truncated = true; return; }
    scanned++;
    const entries = await list(path);
    if (directMatter || entries.some((e) => e.kind === "file" && CARD_FILES.includes(e.name))) {
      paths.push(path);
      return;
    }
    const clientFolder = insideClient || entries.some((e) => e.kind === "file" && CLIENT_CARDS.includes(e.name));
    // Vault vedený bez karet (AK/<písmeno>/<klient>/<věc>): podsložky klienta jsou věci; klient bez nich
    // (nebo s vlastními soubory) je věcí sám - z přehledu se nic neztratí. Tvar se `Spisy/` platí dál.
    // Klient s kartou (client.md/klient.md) je OKF klient - i bez věcí zůstává klientem, ne věcí.
    const hasClientCard = entries.some((e) => e.kind === "file" && CLIENT_CARDS.includes(e.name));
    if (hasClientCard) clientPaths.push(path);
    if (AK_CLIENT.test(path) && !hasClientCard && !entries.some((e) => e.kind === "dir" && [MATTERS_DIR, "Veci"].includes(e.name))) {
      const matters = entries.filter((e) => e.kind === "dir" && !e.name.startsWith(".") && !SKIP_DIRECTORIES.has(e.name) && !isWorkDir(e.name));
      const ownFiles = entries.some((e) => e.kind === "file" && !e.name.startsWith("."));
      if (matters.length === 0 || ownFiles) paths.push(path);
      for (const matter of matters) {
        if (paths.length >= MAX_MATTERS) { truncated = true; break; }
        await discover(matter.path, true, depth + 1, true);
      }
      return;
    }
    for (const child of entries.filter((e) => e.kind === "dir" && !e.name.startsWith(".") && !SKIP_DIRECTORIES.has(e.name))) {
      if (scanned >= MAX_DISCOVERY_DIRECTORIES || paths.length >= MAX_MATTERS) { truncated = true; break; }
      // Preserve empty legacy matters only inside a recognised client or the existing AK profile.
      if ([MATTERS_DIR, "Veci"].includes(child.name) && (clientFolder || path.startsWith("AK/"))) {
        for (const matter of await dirs(child.path)) await discover(matter, true, depth + 2, clientFolder);
      } else await discover(child.path, false, depth + 1, clientFolder);
    }
  };
  await discover("");

  type Bundle = { records: MatterInput["records"]; files: Record<string, string> };
  const bundles = new Map<string, Promise<Bundle>>();
  // Názov klienta z jeho karty; jedna karta sa číta raz, aj keď má klient veľa vecí.
  const clientTitles = new Map<string, Promise<string | undefined>>();
  const clientTitle = (clientPath: string): Promise<string | undefined> => {
    const cached = clientTitles.get(clientPath);
    if (cached) return cached;
    const pending = (async () => {
      const card = (await list(clientPath)).find((e) => e.kind === "file" && CLIENT_CARDS.includes(e.name));
      if (!card) return undefined;
      const title = parseFrontmatter((await client.readWorkspaceFile(workspaceId, childPath(clientPath, card.name))).content)?.title;
      return typeof title === "string" && title.trim() ? title.trim() : undefined;
    })().catch((e: unknown) => { problems.push({ path: clientPath, message: message(e), scope: "client" }); return undefined; });
    clientTitles.set(clientPath, pending);
    return pending;
  };
  const readBundle = (dir: string): Promise<Bundle> => {
    let pending = bundles.get(dir);
    if (!pending) {
      pending = (async () => {
        const records: MatterInput["records"] = [];
        const files: Record<string, string> = {};
        const hasMemory = (await list(dir)).some((e) => e.kind === "dir" && e.name === MEMORY_DIR);
        for (const file of (hasMemory ? await list(childPath(dir, MEMORY_DIR)) : []).slice().sort((a, b) => a.name.localeCompare(b.name))) {
          if (file.kind === "dir") { problems.push({ path: file.path, message: "Vnorená pamäť nie je podporovaná; presuň záznamy do memory/." }); continue; }
          if (file.kind !== "file" || !file.name.endsWith(".md") || RESERVED.has(file.name)) continue;
          try {
            const record = parseRecord((await client.readWorkspaceFile(workspaceId, file.path)).content);
            if (files[record.id]) problems.push({ path: file.path, message: `Duplicitné ID ${record.id}.` });
            records.push(record);
            files[record.id] ??= file.path;
          } catch (e) { problems.push({ path: file.path, message: message(e) }); }
        }
        return { records, files };
      })();
      bundles.set(dir, pending);
    }
    return pending;
  };
  const matters = await mapLimit(paths, CONCURRENCY, async (path): Promise<MatterInput> => {
    const scopePaths = [path];
    const recordFiles: Record<string, string> = {};
    const input: MatterInput = { path, records: [], recordFiles, scopePaths };
    const entries = await list(path);
    const cards = CARD_FILES.filter((name) => entries.some((e) => e.kind === "file" && e.name === name));
    if (cards.length > 1) problems.push({ path, message: `Viac kariet veci: ${cards.join(", ")}. Zosúlaď ich obsah; prehľad používa ${cards[0]}.` });
    const card = cards[0];
    if (card) {
      input.cardPath = childPath(path, card);
      try {
        const fm = parseFrontmatter((await client.readWorkspaceFile(workspaceId, childPath(path, card))).content);
        if (!fm) throw new Error("Karta nemá platný frontmatter.");
        input.cardFrontmatter = fm;
      } catch (e) { problems.push({ path: childPath(path, card), message: message(e) }); }
    }
    if (entries.some((e) => e.name === "VSTUPY.md" && e.kind === "file")) {
      try { input.intake = (await client.readWorkspaceFile(workspaceId, childPath(path, "VSTUPY.md"))).content; }
      catch (e) { problems.push({ path: childPath(path, "VSTUPY.md"), message: message(e) }); }
    }
    const ancestors = path.split("/").map((_, i, parts) => parts.slice(0, parts.length - 1 - i).join("/"));
    let clientPath: string | undefined;
    for (const ancestor of ancestors) {
      if ((await list(ancestor)).some((e) => e.kind === "file" && CLIENT_CARDS.includes(e.name))) {
        scopePaths.push(ancestor);
        clientPath = ancestor;
        break;
      }
    }
    for (const ancestor of [path, ...ancestors]) {
      const entries = await list(ancestor);
      const office = ["Office", "_kancelaria"].find((name) => entries.some((e) => e.kind === "dir" && e.name === name));
      if (office) {
        const officePath = ancestor ? `${ancestor}/${office}` : office;
        if (scopePaths.length === 1 && (await list(officePath)).some((e) => e.name === "okf.config" && e.kind === "file")) {
          try {
            const config = parseMemoryFrontmatter((await client.readWorkspaceFile(workspaceId, `${officePath}/okf.config`)).content);
            const pattern = config.get("client_path");
            if (typeof pattern === "string" && pattern.trim()) {
              const found = ancestors.filter(Boolean).find((candidate) => {
                const relative = ancestor ? candidate.slice(ancestor.length + 1) : candidate;
                const parts = relative.split("/").filter(Boolean);
                const expected = pattern.split("/").filter(Boolean);
                return parts.length === expected.length && expected.every((part, i) => part === "*" || part === parts[i]);
              });
              if (found) {
                scopePaths.push(found);
                clientPath = found;
              }
            }
          } catch (e) { problems.push({ path: `${officePath}/okf.config`, message: message(e) }); }
        }
        scopePaths.push(officePath);
        break;
      }
    }
    for (const dir of scopePaths) {
      const bundle = await readBundle(dir);
      for (const record of bundle.records) {
        if (recordFiles[record.id]) problems.push({ path: bundle.files[record.id], message: `Duplicitné ID ${record.id} v rozsahu veci ${path}.` });
        recordFiles[record.id] ??= bundle.files[record.id];
        input.records.push(record);
      }
    }
    if (clientPath !== undefined) {
      const title = await clientTitle(clientPath);
      if (title) input.clientTitle = title;
    }
    if (clientPath !== undefined && (await list(clientPath)).some((entry) => entry.name === "VSTUPY.md" && entry.kind === "file")) {
      const intakePath = childPath(clientPath, "VSTUPY.md");
      try {
        input.inheritedIntakes = [{ content: (await client.readWorkspaceFile(workspaceId, intakePath)).content, path: intakePath, scope: "client" }];
      } catch (e) { problems.push({ path: intakePath, message: message(e), scope: "client" }); }
    }
    const existingMemorySources: string[] = [];
    for (const dir of scopePaths) {
      const entries = await list(dir);
      for (const name of ["MEMORY.md", "_memory.md"]) {
        if (entries.some((entry) => entry.name === name && entry.kind === "file")) existingMemorySources.push(childPath(dir, name));
      }
      if (entries.some((entry) => entry.name === ".lawoss" && entry.kind === "dir")) {
        const profilePath = childPath(childPath(dir, ".lawoss"), "memory-profile.json");
        if ((await list(childPath(dir, ".lawoss"), true)).some((entry) => entry.path === profilePath && entry.kind === "file")) existingMemorySources.push(profilePath);
      }
    }
    if (existingMemorySources.length) input.existingMemorySources = existingMemorySources;
    const isIn = (file: string | undefined, directory: string): boolean => directory === "" || file === directory || file?.startsWith(`${directory}/`) === true;
    const scopeOf = (file: string | undefined): "matter" | "client" | "office" => {
      if (isIn(file, path)) return "matter";
      if (clientPath !== undefined && isIn(file, clientPath)) return "client";
      return "office";
    };
    for (const finding of validateStore(input.records, { today: todayIso })) {
      if (finding.severity !== "error") continue;
      const source = recordFiles[finding.recordId];
      problems.push({
        path: source ?? path,
        message: finding.message,
        kind: "validation",
        scope: scopeOf(source),
      });
    }
    if (entries.some((entry) => entry.name === "_STATUS.md" && entry.kind === "file")) {
      const statusPath = childPath(path, "_STATUS.md");
      try { input.manualStatus = readManualStatus((await client.readWorkspaceFile(workspaceId, statusPath)).content, input.records, todayIso); }
      catch (error) { problems.push({ path: statusPath, message: message(error) }); }
    }
    return input;
  });
  // Súbežné čítanie pridáva problémy v náhodnom poradí; zoradené sa nemenia, kým sa nezmenia súbory
  // (inak by zdieľanie štruktúry v react-query hlásilo zmenu a pohľad by sa zbytočne prekreslil).
  // Klient bez vecí je stále klient: Klienti a veci ho ukážu (D1 2026-10-04). Poradie podľa cesty kvôli zdieľaniu štruktúry.
  const clients = (await mapLimit([...clientPaths].sort(), CONCURRENCY, async (clientPath): Promise<OkfClient> => {
    const title = await clientTitle(clientPath);
    return title ? { path: clientPath, title } : { path: clientPath };
  }));
  problems.sort((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
  return { ...buildOverview(matters, todayIso), problems, truncated, inputs: matters, clients };
}

/** Spojenie na server rovnako ako v Novom spise, len ako hook. */
const SERVER_SETTINGS_CHANGED = "legalwork-server-settings-changed";

/** LAWOSS: rozsah kanceláře byl obnoven (lite/office-scope) - stránky načtou spojení i data znovu. */
export const OFFICE_SCOPE_RESTORED = "lawoss-office-scope-restored";

export function useOkfConnection(): { connection: OkfConnection | null; error: string | null } {
  const [connection, setConnection] = useState<OkfConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Server může po přepnutí složky vydat nové spojení (adresa, token) - upstream to ohlásí
  // událostí; bez nového načtení by stránka četla starým tokenem a hlásila chybu.
  const queries = useQueryClient();
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const onChange = () => setGeneration((value) => value + 1);
    for (const name of [SERVER_SETTINGS_CHANGED, OFFICE_SCOPE_RESTORED]) window.addEventListener(name, onChange);
    return () => { for (const name of [SERVER_SETTINGS_CHANGED, OFFICE_SCOPE_RESTORED]) window.removeEventListener(name, onChange); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadOkfConnection()
      .then((next) => {
        if (cancelled) return;
        setConnection(next); setError(null);
        // Po změně spojení i čtení se stejným klíčem (token beze změny) musí proběhnout znovu.
        if (generation > 0) void queries.invalidateQueries({ queryKey: ["okf-overview"] });
      })
      .catch((e: unknown) => { if (!cancelled) setError(message(e)); });
    return () => { cancelled = true; };
  }, [generation]);
  return { connection, error };
}

export function activeWorkspace(connection: OkfConnection | null): RouteWorkspace | null {
  if (!connection) return null;
  return connection.workspaces.find((w) => w.id === connection.activeWorkspaceId) ?? connection.workspaces[0] ?? null;
}

/**
 * Lite: kancelář = nejvzdálenější registrovaná lokální složka, která aktivní složku obsahuje.
 * Rychlá akce aktivuje složku spisu (konverzace běží nad ním), ale Dnes a Klienti mají dál ukazovat celou kancelář.
 * Pro zůstává na `activeWorkspace` - tam je výběr složky v postranním panelu záměrný.
 */
export function officeWorkspace(connection: OkfConnection | null): RouteWorkspace | null {
  return officeOf(connection?.workspaces ?? [], activeWorkspace(connection));
}

/** Nejvzdálenější registrovaná lokální složka, která `active` obsahuje; jinak `active` samo. */
export function officeOf(workspaces: readonly RouteWorkspace[], active: RouteWorkspace | null): RouteWorkspace | null {
  if (!active?.path || active.workspaceType === "remote") return active;
  const inner = normalizeDirectoryPath(active.path);
  const ancestors = workspaces.filter((w) => {
    if (w.id === active.id || !w.path || w.workspaceType === "remote") return false;
    const outer = normalizeDirectoryPath(w.path);
    return inner.startsWith(outer.endsWith("/") ? outer : `${outer}/`);
  });
  return ancestors.sort((a, b) => normalizeDirectoryPath(a.path).length - normalizeDirectoryPath(b.path).length)[0] ?? active;
}

/** Ako často sa pohľady z OKF ticho obnovujú, kým je okno aktívne. */
export const OKF_REFRESH_MS = 15_000;
/** Strop pre veľkú kanceláriu: obnova nesmie bežať dlhšie, než trvá samotné čítanie. */
const OKF_REFRESH_MAX_MS = 120_000;
/** Posledná dĺžka čítania podľa workspace; dlhé čítanie predĺži interval. */
const readDurations = new Map<string, number>();

/** 15 s, alebo desaťnásobok posledného čítania, najviac 2 minúty. */
export function okfRefreshInterval(lastReadMs: number | undefined): number {
  return Math.min(OKF_REFRESH_MAX_MS, Math.max(OKF_REFRESH_MS, Math.round((lastReadMs ?? 0) * 10)));
}

export function useOkfOverview(connection: OkfConnection | null, workspace: RouteWorkspace | null) {
  const client = connection?.client ?? null;
  return useQuery({
    // Adresa a token v klíči: nové spojení = nové čtení (cache je jen v paměti, nikam se neukládá).
    queryKey: ["okf-overview", workspace?.id ?? "", connection?.baseUrl ?? "", connection?.token ?? ""],
    enabled: Boolean(client && workspace),
    queryFn: async () => {
      if (!client || !workspace) throw new Error("Server LAWOSS nebeží alebo chýba workspace.");
      const started = Date.now();
      try { return await readWorkspaceMemory(client, workspace.id); }
      finally { readDurations.set(workspace.id, Date.now() - started); }
    },
    // Pohľady sú živé: zápis agenta alebo advokáta do OKF súborov sa ukáže bez reštartu.
    // Obnovuje sa pri návrate do okna a v tichosti na pozadí; zmena sa prekreslí len pri inom obsahu.
    refetchOnWindowFocus: true,
    refetchInterval: () => okfRefreshInterval(workspace ? readDurations.get(workspace.id) : undefined),
    refetchIntervalInBackground: false,
  });
}

// ── zobrazenie ────────────────────────────────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Date-only values are calendar days, independent of the machine's time zone. */
function calendarDay(iso: string): Date | null {
  if (!ISO_DAY.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? date : null;
}

export function formatDay(iso: string, locale = "sk"): string {
  const date = calendarDay(iso);
  // Jiný rok než letošní se píše - lhůta za rok nesmí vypadat jako příští týden.
  return date ? new Intl.DateTimeFormat(locale, {
    weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC",
    ...(iso.slice(0, 4) === today().slice(0, 4) ? {} : { year: "numeric" }),
  }).format(date) : iso;
}

export function formatLongDay(iso: string, locale = "sk"): string {
  const date = calendarDay(iso);
  if (!date) return iso;
  const value = new Intl.DateTimeFormat(locale, {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  }).format(date);
  return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1);
}

/** Trieda `lw-d` podľa blízkosti termínu. */
export function dayClass(date: string, todayIso: string): string {
  // Neplatné datum (ne RRRR-MM-DD) nemá barvu naléhavosti - porovnání textu by lhalo.
  if (!ISO_DAY.test(date)) return "lw-d";
  const tier: DeadlineTier = deadlineTier(date, todayIso);
  return tier === "overdue" || tier === "today" ? "lw-d urg" : tier === "soon" ? "lw-d soon" : "lw-d";
}

export { addDays };

/** Kalendářní den podle hodin počítače, ne UTC - „dnes / zítra / po lhůtě“ se po půlnoci neposouvá o den. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
