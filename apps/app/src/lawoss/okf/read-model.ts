/**
 * Načítanie pamäte spisov cez server API — iba čítanie, nič nezapisuje.
 *
 * Objaví veci podľa kariet v pracovnom priečinku a z každej načíta kanonickú alebo staršiu kartu
 * a pamäť veci, klienta aj kancelárie (okrem index.md a log.md), rozparsuje
 * ich cez `parseRecord` a zloží prehľad cez `buildOverview`. Poškodený súbor
 * nezhodí celé čítanie — skončí v `problems` a zvyšok sa spracuje.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { normalizeDirectoryPath, normalizeDirectoryQueryPath } from "@/app/utils";

import { addDays, buildOverview, deadlineTier, ISO_DAY, isCalendarDay, missingScopeLevels, type DeadlineTier, type MatterInput, type MatterOverview, type Overview } from "../../../../../lawoss/okf/read";
import type { OkfRecord } from "../../../../../lawoss/okf-pamat/src/record.ts";
import { parseRecord } from "../../../../../lawoss/okf-pamat/src/record.ts";
import { validateStore } from "../../../../../lawoss/okf-pamat/src/validate.ts";
import { loadOkfConnection, type OkfConnection } from "./connection";
import type { OfficeMemoryRead } from "./office-memory";

export type OkfReadClient = Pick<LegalworkServerClient, "listWorkspaceDirectory" | "readWorkspaceFile">;
import { readOkfRoot, mapLimit, message, missing, MAX_MATTERS } from '../../../../../lawoss/okf-reader/src/reader.ts';
import type { OkfReadResult, OkfClient, ReadProblem } from '../../../../../lawoss/okf-reader/src/reader.ts';
import { today, okfRefreshInterval, OKF_REFRESH_MS } from '../../../../../lawoss/okf-reader/src/time.ts';
export { MAX_MATTERS, MAX_DISCOVERY_DIRECTORIES, message, missing } from '../../../../../lawoss/okf-reader/src/reader.ts';
export type { OkfReadResult, OkfClient } from '../../../../../lawoss/okf-reader/src/reader.ts';
export { today, okfRefreshInterval, OKF_REFRESH_MS } from '../../../../../lawoss/okf-reader/src/time.ts';
export function readWorkspaceMemory(client: OkfReadClient, workspaceId: string, todayIso = today()): Promise<OkfReadResult> {
  return readOkfRoot({
    list: path => client.listWorkspaceDirectory(workspaceId, path),
    readText: async path => (await client.readWorkspaceFile(workspaceId, path)).content,
  }, todayIso);
}

// ── rozsah praxe (N1, rozhodnutie MČ 16. 10. 2026) ───────────────────────────

/** Člen rozsahu: registrovaný pracovný priečinok a jeho cesta voči koreňu rozsahu („“ = koreň). */
export type OkfScopeMember = { workspace: RouteWorkspace; prefix: string };
/**
 * Čo pohľady čítajú: jeden pracovný priečinok, alebo pri praxi „každý klient zvlášť“ všetky registrované
 * priečinky pod koreňom praxe. Prax sa neregistruje (R7 specu k#92): číta ju len appka, agent ostáva
 * v jednom klientovi. Cesty v prehľade sú voči koreňu praxe; akcie ich prekladajú cez `locateInScope`.
 */
export type OkfScope = {
  /** Priečinok, z ktorého sa rozsah určil; jeho názov ukazujú stavové texty. */
  anchor: RouteWorkspace;
  members: readonly OkfScopeMember[];
  /** Koreň praxe, ak rozsah skladá klientov praxe; jeho `Office/` číta hostiteľ. */
  practiceRoot?: string;
};
export type OkfScopeClient = OkfReadClient & Partial<Pick<LegalworkServerClient, "lawossOfficeMemory">>;

const queryPath = (path: string | undefined): string => normalizeDirectoryQueryPath(path);
/** `inner` je `outer` alebo leží v ňom; veľkosť písmen podľa platformy ako `officeOf`. */
const within = (outer: string, inner: string): boolean => {
  const a = normalizeDirectoryPath(outer);
  const b = normalizeDirectoryPath(inner);
  return Boolean(a && b) && (a === b || b.startsWith(a.endsWith("/") ? a : `${a}/`));
};
const joinPath = (prefix: string, path: string): string => !prefix ? path : !path ? prefix : `${prefix}/${path}`;

/**
 * Rozsah pre kotvu: ak leží v koreni praxe z profilu onboardingu (`officeRoot`), všetci klienti praxe;
 * inak len kotva. Vnorené priečinky (vec registrovaná rýchlou akciou) číta ich klient, nie zvlášť.
 * Registrovaný koreň praxe („jeden priečinok pre všetko“, R8) je jediný člen.
 */
export function okfScope(workspaces: readonly RouteWorkspace[], anchor: RouteWorkspace | null, practiceRoot?: string | null): OkfScope | null {
  if (!anchor) return null;
  const single: OkfScope = { anchor, members: [{ workspace: anchor, prefix: "" }] };
  const local = (w: RouteWorkspace) => w.workspaceType !== "remote" && Boolean(w.path);
  if (!practiceRoot || !local(anchor) || !within(practiceRoot, anchor.path)) return single;
  const inside = workspaces.filter((w) => local(w) && within(practiceRoot, w.path));
  const top = inside.filter((w) => !inside.some((other) => other.id !== w.id && within(other.path, w.path) && !within(w.path, other.path)));
  const root = top.find((w) => within(w.path, practiceRoot));
  if (root) return { anchor, members: [{ workspace: root, prefix: "" }] };
  const base = queryPath(practiceRoot);
  const members = top
    .map((workspace) => ({ workspace, prefix: queryPath(workspace.path).slice(base.length).replace(/^\/+/, "") }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
  return members.length ? { anchor, members, practiceRoot } : single;
}

/** Cesta z prehľadu → priečinok, ktorý ju obsahuje, a cesta v ňom (najdlhšia zhoda). */
export function locateInScope(scope: OkfScope, path: string): { workspace: RouteWorkspace; path: string } | null {
  let best: OkfScopeMember | undefined;
  for (const member of scope.members) {
    const hit = member.prefix === "" || path === member.prefix || path.startsWith(`${member.prefix}/`);
    if (hit && (!best || member.prefix.length > best.prefix.length)) best = member;
  }
  if (!best) return null;
  return { workspace: best.workspace, path: !best.prefix ? path : path === best.prefix ? "" : path.slice(best.prefix.length + 1) };
}

/**
 * Vec z prehľadu v jej vlastnom priečinku: rýchla akcia, konverzácia aj zápis bežia nad klientom veci,
 * nikdy nad celou praxou. `discovered` sú veci toho istého priečinka s cestami v ňom.
 */
export function localMatter(scope: OkfScope, matter: MatterOverview, matters: readonly MatterOverview[]): { workspace: RouteWorkspace; selected: MatterOverview; discovered: MatterOverview[] } | null {
  const target = locateInScope(scope, matter.path);
  if (!target) return null;
  const discovered = matters.flatMap((m) => {
    const at = locateInScope(scope, m.path);
    return at && at.workspace.id === target.workspace.id ? [{ ...m, path: at.path, ...(m.cardPath ? { cardPath: locateInScope(scope, m.cardPath)?.path ?? m.cardPath } : {}) }] : [];
  });
  const selected = discovered.find((m) => m.path === target.path);
  return selected ? { workspace: target.workspace, selected, discovered } : null;
}

function prefixInput(input: MatterInput, prefix: string): MatterInput {
  if (!prefix) return input;
  const at = (path: string) => joinPath(prefix, path);
  return {
    ...input,
    path: at(input.path),
    ...(input.cardPath !== undefined ? { cardPath: at(input.cardPath) } : {}),
    ...(input.scopePaths ? { scopePaths: input.scopePaths.map(at) } : {}),
    ...(input.inheritedIntakes ? { inheritedIntakes: input.inheritedIntakes.map((i) => ({ ...i, path: at(i.path) })) } : {}),
    ...(input.existingMemorySources ? { existingMemorySources: input.existingMemorySources.map(at) } : {}),
    ...(input.recordFiles ? { recordFiles: Object.fromEntries(Object.entries(input.recordFiles).map(([id, file]) => [id, at(file)])) } : {}),
  };
}

type OfficeBundle = { directory: string; records: OkfRecord[]; files: Record<string, string> };

async function readOfficeBundle(client: OkfScopeClient, problems: ReadProblem[], todayIso: string): Promise<OfficeBundle | null> {
  if (!client.lawossOfficeMemory) return null;
  let read: OfficeMemoryRead;
  try { read = await client.lawossOfficeMemory(); }
  catch (e) { problems.push({ path: "Office", message: message(e), scope: "office" }); return null; }
  for (const problem of read.problems) problems.push({ ...problem, scope: "office" });
  if (read.truncated) problems.push({ path: `${read.directory ?? "Office"}/memory`, message: "Neúplný výpis pamäte kancelárie.", scope: "office" });
  if (!read.directory) return null;
  const bundle: OfficeBundle = { directory: read.directory, records: [], files: {} };
  for (const file of read.files) {
    try {
      const record = parseRecord(file.content);
      if (bundle.files[record.id]) problems.push({ path: file.path, message: `Duplicitné ID ${record.id}.`, scope: "office" });
      bundle.records.push(record);
      bundle.files[record.id] ??= file.path;
    } catch (e) { problems.push({ path: file.path, message: message(e), scope: "office" }); }
  }
  for (const finding of validateStore(bundle.records, { today: todayIso })) {
    if (finding.severity === "error") problems.push({ path: bundle.files[finding.recordId] ?? bundle.directory, message: finding.message, kind: "validation", scope: "office" });
  }
  return bundle;
}

/** Vec bez kancelárie vo svojom priečinku dostane kanceláriu praxe, ako keby ju našla medzi predkami. */
function withOffice(input: MatterInput, office: OfficeBundle | null, problems: ReadProblem[]): MatterInput {
  const scopePaths = input.scopePaths ?? [input.path];
  if (!office || !missingScopeLevels(scopePaths).includes("office")) return input;
  const recordFiles = { ...input.recordFiles };
  const records = [...input.records];
  for (const record of office.records) {
    if (recordFiles[record.id]) { problems.push({ path: office.files[record.id], message: `Duplicitné ID ${record.id} v rozsahu veci ${input.path}.`, scope: "office" }); continue; }
    recordFiles[record.id] = office.files[record.id];
    records.push(record);
  }
  return { ...input, records, recordFiles, scopePaths: [...scopePaths, office.directory] };
}

/**
 * Jeden prehľad z celého rozsahu: každý priečinok sa číta ako doteraz (`readWorkspaceMemory`), cesty
 * dostanú predponu voči koreňu praxe a pravidlá `buildOverview` bežia raz nad všetkým (ADR 0014, 1 a 2).
 */
export async function readScopeMemory(client: OkfScopeClient, scope: OkfScope, todayIso: string = today()): Promise<OkfReadResult> {
  if (!scope.practiceRoot && scope.members.length === 1 && scope.members[0].prefix === "") {
    return readWorkspaceMemory(client, scope.members[0].workspace.id, todayIso);
  }
  const problems: ReadProblem[] = [];
  const parts = await mapLimit(scope.members, 2, (member) => readWorkspaceMemory(client, member.workspace.id, todayIso));
  const office = scope.practiceRoot ? await readOfficeBundle(client, problems, todayIso) : null;
  let truncated = parts.some((part) => part.truncated);
  let inputs = parts.flatMap((part, i) => part.inputs.map((input) => withOffice(prefixInput(input, scope.members[i].prefix), office, problems)));
  if (inputs.length > MAX_MATTERS) { inputs = inputs.slice(0, MAX_MATTERS); truncated = true; }
  parts.forEach((part, i) => {
    for (const problem of part.problems) problems.push({ ...problem, path: joinPath(scope.members[i].prefix, problem.path) });
  });
  const clients = parts.flatMap((part, i) => (part.clients ?? []).map((c) => ({ ...c, path: joinPath(scope.members[i].prefix, c.path) })))
    .sort((a, b) => a.path.localeCompare(b.path));
  problems.sort((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
  return { ...buildOverview(inputs, todayIso), problems, truncated, inputs, clients };
}

/**
 * Rozsah pohľadu: koreň praxe z profilu onboardingu, kým sa nenačíta `pending` (žiadne čítanie jedného
 * klienta, ktoré by o chvíľu nahradila celá prax). Bez profilu alebo pri chybe ostane jeden priečinok.
 */
export function useOkfScope(connection: OkfConnection | null, anchor: RouteWorkspace | null): { scope: OkfScope | null; pending: boolean } {
  const client = connection?.client ?? null;
  const root = useQuery({
    queryKey: ["okf-practice-root", connection?.baseUrl ?? "", connection?.token ?? ""],
    enabled: Boolean(client),
    queryFn: async () => (await client?.onboardingStatus())?.profile?.officeRoot ?? null,
    // Bez staleTime: po onboardingu praxe nová stránka hneď číta celú prax, nie len otvoreného klienta.
    retry: false,
  });
  const practiceRoot = !client || root.isError ? null : root.data;
  const workspaces = connection?.workspaces;
  const scope = useMemo(
    () => practiceRoot === undefined ? null : okfScope(workspaces ?? [], anchor, practiceRoot),
    [workspaces, anchor, practiceRoot],
  );
  return { scope, pending: practiceRoot === undefined && anchor !== null };
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

const readDurations = new Map<string, number>();

/** Kľúč rozsahu: členovia a koreň praxe; nový klient v praxi = nové čítanie. */
const scopeKey = (scope: OkfScope | null): string => scope ? [scope.practiceRoot ?? "", ...scope.members.map((m) => `${m.workspace.id}:${m.prefix}`)].join("|") : "";

export function useOkfOverview(connection: OkfConnection | null, scope: OkfScope | null) {
  const client = connection?.client ?? null;
  const key = scopeKey(scope);
  return useQuery({
    // Adresa a token v klíči: nové spojení = nové čtení (cache je jen v paměti, nikam se neukládá).
    queryKey: ["okf-overview", key, connection?.baseUrl ?? "", connection?.token ?? ""],
    enabled: Boolean(client && scope),
    queryFn: async () => {
      if (!client || !scope) throw new Error("Server LAWOSS nebeží alebo chýba workspace.");
      const started = Date.now();
      try { return await readScopeMemory(client, scope); }
      finally { readDurations.set(key, Date.now() - started); }
    },
    // Pohľady sú živé: zápis agenta alebo advokáta do OKF súborov sa ukáže bez reštartu.
    // Obnovuje sa pri návrate do okna a v tichosti na pozadí; zmena sa prekreslí len pri inom obsahu.
    // Prax: interval sa počíta z čítania celej praxe, nie jedného klienta (ADR 0014, bod 3).
    refetchOnWindowFocus: true,
    refetchInterval: () => okfRefreshInterval(scope ? readDurations.get(key) : undefined),
    refetchIntervalInBackground: false,
  });
}

// ── zobrazenie ────────────────────────────────────────────────────────────

/** Date-only values are calendar days, independent of the machine's time zone. */
const calendarDay = (iso: string): Date | null => isCalendarDay(iso) ? new Date(`${iso}T00:00:00Z`) : null;

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
