import { diagnosticFields, OkfDiagnostic, type DiagnosticFields } from "../../../../../lawoss/okf/diagnostics";
import { isManagedDeadline } from "../../../../../lawoss/okf/deadline-workflow.ts";
/**
 * Načítanie pamäte spisov cez server API — iba čítanie, nič nezapisuje.
 *
 * Objaví veci podľa kariet v pracovnom priečinku a z každej načíta kanonickú alebo staršiu kartu
 * a pamäť veci, klienta aj kancelárie (okrem index.md a log.md), rozparsuje
 * ich cez `parseRecord` a zloží prehľad cez `buildOverview`. Poškodený súbor
 * nezhodí celé čítanie — skončí v `problems` a zvyšok sa spracuje.
 */
import { readManualStatus } from "../../../../../lawoss/okf-pamat/src/manual-status.ts";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { LegalworkServerError, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { normalizeDirectoryPath, normalizeDirectoryQueryPath } from "@/app/utils";

import { addDays, buildOverview, deadlineTier, ISO_DAY, isCalendarDay, missingScopeLevels, type DeadlineTier, type MatterInput, type MatterOverview, type Overview } from "../../../../../lawoss/okf/read";
import type { OkfRecord } from "../../../../../lawoss/okf-pamat/src/record.ts";
import { parseFrontmatter } from "../../../../../lawoss/okf/src/core";
import { looksLikeMatterFolder } from "../../../../../lawoss/okf/src/onboarding/suggest-patterns.ts";
import { parseRecord, parseFrontmatter as parseMemoryFrontmatter } from "../../../../../lawoss/okf-pamat/src/record.ts";
import { validateStore } from "../../../../../lawoss/okf-pamat/src/validate.ts";
import { selectSourceSnapshot } from "./practice-read-state";
import { loadOkfConnection, type OkfConnection } from "./connection";
import type { OfficeMemoryRead } from "./office-memory";

export type OkfReadClient = Pick<LegalworkServerClient, "listWorkspaceDirectory" | "readWorkspaceFile"> & Partial<Pick<LegalworkServerClient, "lawossDeadlineRequest">>;
/** `folderUnavailable`: id pracovného priestoru, ktorého priečinok na disku chýba (presunutý, premenovaný, odpojený disk). */
type ReadProblem = DiagnosticFields & { path: string; message: string; kind?: "validation"; scope?: "matter" | "client" | "office"; folderUnavailable?: string };

/** Server: priečinok pracovného priestoru na disku nie je (`resolveWorkspace`, 404). */
export const FOLDER_UNAVAILABLE = "project_folder_unavailable";
export const isFolderUnavailable = (error: unknown): boolean => error instanceof LegalworkServerError && error.code === FOLDER_UNAVAILABLE;
export type OkfSourceReadState = { source: "workspace" | "office"; workspaceId?: string; checkedAt: number; lastSuccessAt: number | null; state: "fresh" | "stale" | "unavailable" | "truncated" };
export type OkfCoverage = { status: "complete" | "partial" | "failed"; scopeKey: string; sources: readonly OkfSourceReadState[] };
type SourceSnapshot = { inputs: MatterInput[]; clients: OkfClient[]; office?: OfficeBundle | null };
export type OkfReadOptions = {
  signal?: AbortSignal; previous?: OkfReadResult; now?: () => number;
  /** Relatívne cesty (NFC) zaregistrovaných priečinkov vo vnútri čítaného priečinka (`OkfScopeMember.nested`). */
  registeredNested?: readonly string[];
};
export type OkfReadResult = Overview & {
  coverage: OkfCoverage;
  /** RAM-only successful source snapshots, never a second store. */
  sourceSnapshots?: Record<string, SourceSnapshot>;
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
export const missing = (e: unknown): boolean => /(?:\b404\b|\bENOENT\b|not[_ ]found)/i.test(message(e));
export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
  options: OkfReadOptions = {},
): Promise<OkfReadResult> {
  options.signal?.throwIfAborted();
  const problems: ReadProblem[] = [];
  const readFile = (path: string) => client.readWorkspaceFile(workspaceId, path, { signal: options.signal });
  let truncated = false;
  type Listing = Awaited<ReturnType<OkfReadClient["listWorkspaceDirectory"]>>;
  const cache = new Map<string, Promise<Listing["entries"]>>();
  const list = (path: string, optional = false): Promise<Listing["entries"]> => {
    let pending = cache.get(path);
    if (!pending) {
      pending = client.listWorkspaceDirectory(workspaceId, path, { signal: options.signal }).then((result) => {
        if (result.truncated) {
          truncated = true;
          problems.push({ path, message: "Neúplný výpis priečinka zo servera.", code: "okf.listing_incomplete" });
        }
        return result.entries;
      }).catch((e: unknown) => {
        if (isFolderUnavailable(e)) problems.push({ path, message: message(e), ...diagnosticFields(e), folderUnavailable: workspaceId });
        else if (!optional || !missing(e)) problems.push({ path, message: message(e), ...diagnosticFields(e) });
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
  const registeredNested = new Set((options.registeredNested ?? []).map((path) => path.normalize("NFC")));
  let scanned = 0;
  const discover = async (path: string, directMatter = false, depth = 0, insideClient = false): Promise<void> => {
    if (scanned >= MAX_DISCOVERY_DIRECTORIES || paths.length >= MAX_MATTERS || depth > MAX_DISCOVERY_DEPTH) { truncated = true; return; }
    scanned++;
    const entries = await list(path);
    const hasMatterCard = entries.some((e) => e.kind === "file" && CARD_FILES.includes(e.name));
    // N-A4-4 (test 23. 10. 2026): priečinok s vlastnou kartou klienta vo vnútri iného klienta je vnorený klient,
    // ktorého appka odmieta (MČ 23. 10. 2026). Nie je to prípad vonkajšieho klienta (ani pri kóde `C099 …`) a jeho
    // prípady do prehľadu vonkajšieho klienta nepatria; ostáva len obyčajným priečinkom v Súboroch. Vnorený klient
    // zaregistrovaný ešte pred odmietaním ostáva vlastnou skupinou: prax ho číta cez vonkajšieho klienta (`okfScope`).
    const nestedClient = insideClient && !hasMatterCard && entries.some((e) => e.kind === "file" && CLIENT_CARDS.includes(e.name));
    if (nestedClient && !registeredNested.has(path.normalize("NFC"))) return;
    if ((directMatter && !nestedClient) || hasMatterCard) {
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
      // Priamy podpriečinok klienta s kartou pomenovaný ako vec (`2025-01 Spor`, spisová značka) je vec aj bez
      // karty; rovnaký vzor ako rozpoznanie a roztriedenie (suggest-patterns.ts), D1 2026-10-09.
      } else await discover(child.path, hasClientCard && !isWorkDir(child.name) && looksLikeMatterFolder(child.name), depth + 1, clientFolder);
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
      const title = parseFrontmatter((await readFile(childPath(clientPath, card.name))).content)?.title;
      return typeof title === "string" && title.trim() ? title.trim() : undefined;
    })().catch((e: unknown) => { problems.push({ path: clientPath, message: message(e), ...diagnosticFields(e), scope: "client" }); return undefined; });
    clientTitles.set(clientPath, pending);
    return pending;
  };
  // Oblasti kancelárie (`areas` v okf.config) pre prehľad podľa oblasti; jeden súbor sa číta raz.
  const officeAreaReads = new Map<string, Promise<MatterInput["officeAreas"]>>();
  const officeAreas = (officePath: string): Promise<MatterInput["officeAreas"]> => {
    let pending = officeAreaReads.get(officePath);
    if (!pending) {
      pending = (async () => {
        if (!(await list(officePath)).some((e) => e.name === "okf.config" && e.kind === "file")) return undefined;
        const file = `${officePath}/okf.config`;
        const areas = parseMemoryFrontmatter((await readFile(file)).content).get("areas");
        const labels = Array.isArray(areas) ? areas.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [];
        return labels.length ? { areas: labels, file } : undefined;
      })().catch((e: unknown) => {
        // Rovnaký súbor môže nahlásiť aj čítanie `client_path`; jeden problém na súbor.
        const path = `${officePath}/okf.config`;
        if (!problems.some((p) => p.path === path)) problems.push({ path, message: message(e), ...diagnosticFields(e), scope: "office" });
        return undefined;
      });
      officeAreaReads.set(officePath, pending);
    }
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
          if (file.kind === "dir") { problems.push({ path: file.path, message: "Vnorená pamäť nie je podporovaná; presuň záznamy do memory/.", code: "okf.nested_memory" }); continue; }
          if (file.kind !== "file" || !file.name.endsWith(".md") || RESERVED.has(file.name)) continue;
          try {
            const record = parseRecord((await readFile(file.path)).content);
            if (files[record.id]) problems.push({ path: file.path, message: `Duplicitné ID ${record.id}.`, code: "okf.duplicate_id", params: { id: record.id } });
            records.push(record);
            files[record.id] ??= file.path;
          } catch (e) { problems.push({ path: file.path, message: message(e), ...diagnosticFields(e) }); }
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
    if (cards.length > 1) problems.push({ path, message: `Viac kariet prípadu: ${cards.join(", ")}. Zosúlaď ich obsah; prehľad používa ${cards[0]}.`, code: "okf.multiple_cards", params: { cards: cards.join(", "), selected: cards[0] } });
    const card = cards[0];
    if (card) {
      input.cardPath = childPath(path, card);
      try {
        const fm = parseFrontmatter((await readFile(childPath(path, card))).content);
        if (!fm) throw new OkfDiagnostic("okf.card_invalid", {}, "Karta nemá platný frontmatter.");
        input.cardFrontmatter = fm;
      } catch (e) { problems.push({ path: childPath(path, card), message: message(e), ...diagnosticFields(e) }); }
    }
    if (entries.some((e) => e.name === "VSTUPY.md" && e.kind === "file")) {
      try { input.intake = (await readFile(childPath(path, "VSTUPY.md"))).content; }
      catch (e) { problems.push({ path: childPath(path, "VSTUPY.md"), message: message(e), ...diagnosticFields(e) }); }
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
            const config = parseMemoryFrontmatter((await readFile(`${officePath}/okf.config`)).content);
            const pattern = config.get("client_path");
            // Ako `readClientPath` v CLI: vzor s U+FFFD (ANSI z Windows) nesedí na nič a klient by potichu zmizol.
            if (typeof pattern === "string" && pattern.includes("\uFFFD")) throw new Error("client_path obsahuje poškodený znak (U+FFFD) — súbor nie je v UTF-8 ani v UTF-16 s BOM (napr. ANSI); ulož ho ako UTF-8");
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
          } catch (e) { problems.push({ path: `${officePath}/okf.config`, message: message(e), ...diagnosticFields(e) }); }
        }
        scopePaths.push(officePath);
        const areas = await officeAreas(officePath);
        if (areas) input.officeAreas = areas;
        break;
      }
    }
    for (const dir of scopePaths) {
      const bundle = await readBundle(dir);
      for (const record of bundle.records) {
        if (recordFiles[record.id]) problems.push({ path: bundle.files[record.id], message: `Duplicitné ID ${record.id} v rozsahu prípadu ${path}.`, code: "okf.duplicate_id", params: { id: record.id } });
        recordFiles[record.id] ??= bundle.files[record.id];
        input.records.push(record);
      }
    }
    if (clientPath !== undefined) {
      const title = await clientTitle(clientPath);
      if (title) input.clientTitle = title;
      const card = (await list(clientPath)).find((e) => e.kind === "file" && CLIENT_CARDS.includes(e.name));
      if (card) input.clientCardPath = childPath(clientPath, card.name);
    }
    if (clientPath !== undefined && (await list(clientPath)).some((entry) => entry.name === "VSTUPY.md" && entry.kind === "file")) {
      const intakePath = childPath(clientPath, "VSTUPY.md");
      try {
        input.inheritedIntakes = [{ content: (await readFile(intakePath)).content, path: intakePath, scope: "client" }];
      } catch (e) { problems.push({ path: intakePath, message: message(e), ...diagnosticFields(e), scope: "client" }); }
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
        message: finding.message, code: "okf.validation_failed",
        kind: "validation",
        scope: scopeOf(source),
      });
    }
    if (entries.some((entry) => entry.name === "_STATUS.md" && entry.kind === "file")) {
      const statusPath = childPath(path, "_STATUS.md");
      try { input.manualStatus = readManualStatus((await readFile(statusPath)).content, input.records, todayIso); }
      catch (error) { problems.push({ path: statusPath, message: message(error), ...diagnosticFields(error) }); }
    }
    if (input.records.some(isManagedDeadline)) {
      input.deadlineWorkflowEvidence = {};
      if (client.lawossDeadlineRequest) {
        try {
          const result = await client.lawossDeadlineRequest<{ items: Array<{ candidateId: string; revisionHash: string; recordFingerprint: string; receiptId: string | null; trusted: boolean }> }>(workspaceId, `?matterPath=${encodeURIComponent(path)}`, undefined, { signal: options.signal });
          input.deadlineWorkflowEvidence = Object.fromEntries(result.items.map(item => [item.candidateId, { recordFingerprint: item.recordFingerprint, revisionHash: item.revisionHash, receiptId: item.receiptId, trusted: item.trusted }]));
        } catch { problems.push({ path, message: "Potvrzení lhůt hostitelem se nepodařilo ověřit; zobrazují se k právní kontrole.", code: "okf.deadline_unverified" }); }
      }
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
  options.signal?.throwIfAborted();
  const checkedAt = (options.now ?? Date.now)();
  const valid = !problems.length && !truncated;
  return { ...buildOverview(matters, todayIso), problems, truncated, inputs: matters, clients,
    coverage: { scopeKey: JSON.stringify([workspaceId]), status: valid ? "complete" : matters.length || clients.length ? "partial" : "failed", sources: [{ source: "workspace", workspaceId, checkedAt, lastSuccessAt: valid ? checkedAt : null, state: valid ? "fresh" : truncated ? "truncated" : "unavailable" }] } };

}

// ── rozsah praxe (N1, podklad PR #162) ───────────────────────────

/** Člen rozsahu: registrovaný pracovný priečinok a jeho cesta voči koreňu rozsahu („“ = koreň). */
export type OkfScopeMember = {
  workspace: RouteWorkspace; prefix: string;
  /** Zaregistrované lokálne priečinky vo vnútri člena, relatívne cesty v NFC (N-A4-4); bez nich chýba. */
  nested?: readonly string[];
};
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

const queryPath = (path: string | undefined): string => {
  // A drive root is absolute; the normalized drive-relative spelling Z: is not.
  if (path && /^[A-Za-z]:[\\/]+$/.test(path)) return `${path.slice(0,2)}/`;
  return normalizeDirectoryQueryPath(path);
};
const safeAbsolute = (path: string): boolean => {
  const normalized = queryPath(path);
  return path === path.trim() && /^(?:[A-Za-z]:\/|\/)/.test(normalized) && !normalized.split("/").some(p => p === "." || p === "..") && !normalized.replace(/^\/\//, "/").includes("//");
};
/** Totožnosť cesty: NFC (macOS môže vrátiť názov priečinka v NFD), na Windows bez rozlíšenia veľkosti písmen. */
const pathIdentity = (path: string): string => {
  const normalized = queryPath(path).normalize("NFC");
  return /^(?:[A-Za-z]:|\/\/)/.test(normalized) ? normalized.toLowerCase() : normalized;
};
export function okfScopeKey(scope: OkfScope): string {
  return JSON.stringify([scope.practiceRoot ? pathIdentity(scope.practiceRoot) : null, scope.members.map(m => [m.workspace.id, pathIdentity(m.workspace.path), m.prefix.normalize("NFC"), m.workspace.workspaceType ?? "local", ...(m.nested?.length ? [[...m.nested].sort()] : [])]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}
export function excludedWorkspaceIds(workspaces: readonly RouteWorkspace[], scope: OkfScope | null): string[] {
  return workspaces.filter(w => !scope?.members.some(m => m.workspace.id === w.id || (w.workspaceType !== "remote" && within(m.workspace.path, w.path)))).map(w => w.id).sort();
}
/** `inner` je `outer` alebo leží v ňom; veľkosť písmen podľa platformy ako `officeOf`. */
const within = (outer: string, inner: string): boolean => {
  const a = pathIdentity(outer);
  const b = pathIdentity(inner);
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
  const local = (w: RouteWorkspace) => w.workspaceType !== "remote" && Boolean(w.path);
  const member = (workspace: RouteWorkspace, prefix: string): OkfScopeMember => {
    const nested = local(workspace) ? nestedPaths(workspaces.filter(local), workspace) : [];
    return { workspace, prefix, ...(nested.length ? { nested } : {}) };
  };
  const single: OkfScope = { anchor, members: [member(anchor, "")] };
  if (!practiceRoot || !local(anchor) || !within(practiceRoot, anchor.path)) return single;
  if (!safeAbsolute(practiceRoot)) return null;
  const inside = workspaces.filter((w) => local(w) && within(practiceRoot, w.path));
  if (inside.some(w => !safeAbsolute(w.path)) || new Set(inside.map(w => pathIdentity(w.path))).size !== inside.length) return null;
  const top = inside.filter((w) => !inside.some((other) => other.id !== w.id && within(other.path, w.path) && !within(w.path, other.path)));
  const root = top.find((w) => within(w.path, practiceRoot));
  if (root) return { anchor, members: [member(root, "")] };
  // Predpona z NFC na oboch stranách: `within` porovnáva v NFC, koreň a klient môžu prísť v rôznom tvare (NFD z macOS).
  const base = queryPath(practiceRoot).normalize("NFC");
  const members = top
    .map((workspace) => member(workspace, queryPath(workspace.path).normalize("NFC").slice(base.length).replace(/^\/+/, "")))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
  return members.length ? { anchor, members, practiceRoot } : single;
}

/** Relatívne cesty (NFC) zaregistrovaných priečinkov, ktoré ležia vo vnútri `outer` (nie on sám). */
function nestedPaths(workspaces: readonly RouteWorkspace[], outer: RouteWorkspace): string[] {
  const base = queryPath(outer.path).normalize("NFC").replace(/\/+$/, "");
  return workspaces
    .filter((w) => w.id !== outer.id && within(outer.path, w.path) && pathIdentity(w.path) !== pathIdentity(outer.path))
    .map((w) => queryPath(w.path).normalize("NFC").slice(base.length).replace(/^\/+/, ""))
    .filter(Boolean).sort();
}

/** Cesta z prehľadu → priečinok, ktorý ju obsahuje, a cesta v ňom (najdlhšia zhoda). */
export function locateInScope(scope: OkfScope, path: string): { workspace: RouteWorkspace; path: string } | null {
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some(p => p === "." || p === "..")) return null;
  // Cesta aj predpona v NFC: rez podľa dĺžky predpony inak pri zmiešanom tvare (NFD/NFC) poškodí cestu.
  const nfc = path.normalize("NFC");
  let best: { member: OkfScopeMember; prefix: string } | undefined;
  for (const member of scope.members) {
    const prefix = member.prefix.normalize("NFC");
    const hit = prefix === "" || nfc === prefix || nfc.startsWith(`${prefix}/`);
    if (hit && (!best || prefix.length > best.prefix.length)) best = { member, prefix };
  }
  if (!best) return null;
  return { workspace: best.member.workspace, path: !best.prefix ? path : nfc === best.prefix ? "" : nfc.slice(best.prefix.length + 1) };
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

export function canActOnSource(data: OkfReadResult, workspaceId: string): boolean {
  return data.coverage?.sources.some(source => source.source === "workspace" && source.workspaceId === workspaceId && source.state === "fresh") ?? false;
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

async function readOfficeBundle(client: OkfScopeClient, problems: ReadProblem[], todayIso: string, practiceRoot: string, signal?: AbortSignal): Promise<OfficeBundle | null> {
  if (!client.lawossOfficeMemory) { problems.push({ path: "Office", message: "Server nepodporuje overené čítanie kancelárie.", code: "okf.office_unsupported", scope: "office" }); return null; }
  let read: OfficeMemoryRead;
  try { read = await client.lawossOfficeMemory(practiceRoot, { signal });
    if (pathIdentity(read.practiceRoot ?? "") !== pathIdentity(practiceRoot)) throw new Error("practice_scope_changed"); }
  catch (e) { problems.push({ path: "Office", message: message(e), ...diagnosticFields(e), scope: "office" }); return null; }
  for (const problem of read.problems) problems.push({ ...problem, scope: "office" });
  if (read.truncated) problems.push({ path: `${read.directory ?? "Office"}/memory`, message: "Neúplný výpis pamäte kancelárie.", code: "okf.office_incomplete", scope: "office" });
  if (!read.directory) return null;
  const bundle: OfficeBundle = { directory: read.directory, records: [], files: {} };
  for (const file of read.files) {
    try {
      const record = parseRecord(file.content);
      if (bundle.files[record.id]) problems.push({ path: file.path, message: `Duplicitné ID ${record.id}.`, code: "okf.duplicate_id", params: { id: record.id }, scope: "office" });
      bundle.records.push(record);
      bundle.files[record.id] ??= file.path;
    } catch (e) { problems.push({ path: file.path, message: message(e), ...diagnosticFields(e), scope: "office" }); }
  }
  for (const finding of validateStore(bundle.records, { today: todayIso })) {
    if (finding.severity === "error") problems.push({ path: bundle.files[finding.recordId] ?? bundle.directory, message: finding.message, code: "okf.validation_failed", kind: "validation", scope: "office" });
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
    if (recordFiles[record.id]) { problems.push({ path: office.files[record.id], message: `Duplicitné ID ${record.id} v rozsahu prípadu ${input.path}.`, code: "okf.duplicate_id", params: { id: record.id }, scope: "office" }); continue; }
    recordFiles[record.id] = office.files[record.id];
    records.push(record);
  }
  return { ...input, records, recordFiles, scopePaths: [...scopePaths, office.directory] };
}

/**
 * Jeden prehľad z celého rozsahu: každý priečinok sa číta ako doteraz (`readWorkspaceMemory`), cesty
 * dostanú predponu voči koreňu praxe a pravidlá `buildOverview` bežia raz nad všetkým (ADR 0014, 1 a 2).
 */
export async function readScopeMemory(client: OkfScopeClient, scope: OkfScope, todayIso: string = today(), options: OkfReadOptions = {}): Promise<OkfReadResult> {
  options.signal?.throwIfAborted();
  const key = okfScopeKey(scope);
  const previous = options.previous?.coverage?.scopeKey === key ? options.previous : undefined;
  const problems: ReadProblem[] = [];
  const checkedAt = (options.now ?? Date.now)();
  const sources: OkfSourceReadState[] = [];
  const snapshots: Record<string, SourceSnapshot> = {};
  const parts = await mapLimit(scope.members, 2, member => readWorkspaceMemory(client, member.workspace.id, todayIso, { ...options, ...(member.nested ? { registeredNested: member.nested } : {}) }));
  let truncated = false;
  const select = (id: string, source: "workspace" | "office", current: SourceSnapshot, issues: ReadProblem[], cut: boolean): SourceSnapshot => {
    problems.push(...issues);
    truncated ||= cut;
    const valid = !issues.length && !cut;
    const snapshotKey = JSON.stringify([source,id]);
    const old = previous?.sourceSnapshots?.[snapshotKey];
    const oldState = previous?.coverage.sources.find(s => source === "office" ? s.source === "office" : s.workspaceId === id);
    const selected = selectSourceSnapshot({ current, previous: old, previousState: oldState, source, ...(source === "workspace" ? { workspaceId: id } : {}), checkedAt, valid, truncated: cut });
    if (selected.retain) snapshots[snapshotKey] = selected.snapshot;
    sources.push(selected.state);
    return selected.state.state === "fresh" ? selected.snapshot : { ...selected.snapshot, inputs: selected.snapshot.inputs.map(input => ({ ...input, deadlineWorkflowEvidence: {} })) };
  };
  const selected = parts.map((part,i) => select(scope.members[i].workspace.id, "workspace", { inputs: part.inputs, clients: part.clients ?? [] }, part.problems.map(p => ({ ...p, path: joinPath(scope.members[i].prefix,p.path) })), part.truncated));
  let office: OfficeBundle | null = null;
  if (scope.practiceRoot) {
    const officeProblems: ReadProblem[] = [];
    const current = await readOfficeBundle(client, officeProblems, todayIso, scope.practiceRoot, options.signal);
    office = select("office", "office", { inputs: [], clients: [], office: current }, officeProblems, officeProblems.some(p => p.message.includes("Neúplný"))).office ?? null;
  }
  options.signal?.throwIfAborted();
  let inputs = selected.flatMap((part,i) => part.inputs.map(input => withOffice(prefixInput(input,scope.members[i].prefix),office,problems)));
  if (inputs.length > MAX_MATTERS) { inputs = inputs.slice(0,MAX_MATTERS); truncated = true; }
  if (!inputs.length && office?.records.length) problems.push({ path: office.directory, message: "Pamäť kancelárie obsahuje záznamy bez vecí; tento pohľad ich zatiaľ nevie zobraziť.", code: "okf.office_orphans", scope: "office" });
  const clients = selected.flatMap((part,i) => part.clients.map(c => ({ ...c, path: joinPath(scope.members[i].prefix,c.path) }))).sort((a,b) => a.path.localeCompare(b.path));
  const usable = sources.some(s => s.state === "fresh" || s.state === "stale") || inputs.length > 0 || clients.length > 0;
  const status = !problems.length && !truncated && sources.every(s => s.state === "fresh") ? "complete" : usable ? "partial" : "failed";
  problems.sort((a,b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
  return { ...buildOverview(inputs,todayIso), inputs, clients, problems, truncated, coverage: { scopeKey: key, status, sources }, sourceSnapshots: snapshots };
}

/** Jedno čítanie koreňa praxe pre `usePracticeRoot` aj `useOkfScope` (rovnaký kľúč = jedna cache). */
function usePracticeRootQuery(connection: OkfConnection | null) {
  const client = connection?.client ?? null;
  const root = useQuery({
    queryKey: ["okf-practice-root", connection?.baseUrl ?? "", connection?.token ?? "", connection?.authGeneration ?? 0],
    enabled: Boolean(client),
    queryFn: async () => (await client?.onboardingStatus())?.profile?.officeRoot ?? null,
    // Bez staleTime: po onboardingu praxe nová stránka hneď číta celú prax, nie len otvoreného klienta.
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: true,
    refetchInterval: OKF_REFRESH_MS,
  });
  return root;
}

/** Koreň praxe z profilu onboardingu; `undefined`, kým sa číta, `null` bez praxe alebo pri chybe. */
export function usePracticeRoot(connection: OkfConnection | null): string | null | undefined {
  const root = usePracticeRootQuery(connection);
  return !connection?.client || root.isError ? null : root.data;
}

/**
 * Rozsah pohľadu: koreň praxe z profilu onboardingu, kým sa nenačíta `pending` (žiadne čítanie jedného
 * klienta, ktoré by o chvíľu nahradila celá prax). Chyba čítania profilu = `unavailable` (#168).
 */
export type ScopeResolution = { state: "ready" | "pending" | "unavailable"; scope: OkfScope | null; pending: boolean; excludedWorkspaceIds: readonly string[]; message?: string };
export function useOkfScope(connection: OkfConnection | null, anchor: RouteWorkspace | null): ScopeResolution {
  const client = connection?.client ?? null;
  const root = usePracticeRootQuery(connection);
  const practiceRoot = !client ? null : root.isError ? undefined : root.data;
  const workspaces = connection?.workspaces;
  const scope = useMemo(
    () => practiceRoot === undefined ? null : okfScope(workspaces ?? [], anchor, practiceRoot),
    [workspaces, anchor, practiceRoot],
  );
  const pending = !root.isError && practiceRoot === undefined && anchor !== null;
  return { scope, pending, state: root.isError || (anchor && practiceRoot && !scope) ? "unavailable" : pending ? "pending" : "ready", excludedWorkspaceIds: excludedWorkspaceIds(workspaces ?? [],scope), ...(root.isError ? { message: message(root.error) } : {}) };
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
    const onChange = () => {
      void queries.cancelQueries({ queryKey: ["okf-overview"] });
      queries.removeQueries({ queryKey: ["okf-overview"] });
      void queries.invalidateQueries({ queryKey: ["okf-practice-root"] });
      setConnection(null); setGeneration(value => value + 1);
    };
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

      })
      .catch((e: unknown) => { if (!cancelled) setError(message(e)); });
    return () => { cancelled = true; };
  }, [generation]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") setGeneration(v => v + 1); }, OKF_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
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
/** Posledná dĺžka čítania podľa rozsahu; dlhé čítanie predĺži interval. */
const readDurations = new Map<string, number>();

/** 15 s, alebo desaťnásobok posledného čítania, najviac 2 minúty. */
export function okfRefreshInterval(lastReadMs: number | undefined): number {
  return Math.min(OKF_REFRESH_MAX_MS, Math.max(OKF_REFRESH_MS, Math.round((lastReadMs ?? 0) * 10)));
}

/** Kľúč rozsahu: členovia a koreň praxe; nový klient v praxi = nové čítanie. */
const scopeKey = (scope: OkfScope | null): string => scope ? okfScopeKey(scope) : "";

type OverviewConnection = Pick<OkfConnection, "baseUrl" | "token" | "authGeneration"> & { client: OkfScopeClient | null };
/** Query owner shared by native views; identity and cancellation are captured at read admission. */
export function okfOverviewQueryOptions(connection: OverviewConnection | null, scope: OkfScope | null, day: string, queries: QueryClient) {
  const client = connection?.client ?? null;
  const key = scopeKey(scope);
  const queryKey = ["okf-overview", key, connection?.baseUrl ?? "", connection?.token ?? "", connection?.authGeneration ?? 0, day];
  return {
    queryKey,
    enabled: Boolean(client && scope),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      if (!client || !scope) throw new Error("Server LAWOSS nebeží alebo chýba workspace.");
      const started = Date.now();
      const previous = queries.getQueryData<OkfReadResult>(queryKey) ?? queries.getQueriesData<OkfReadResult>({ queryKey: queryKey.slice(0,-1) })
        .flatMap(([,data]) => data ? [data] : []).sort((a,b) => Math.max(...b.coverage.sources.map(s => s.checkedAt)) - Math.max(...a.coverage.sources.map(s => s.checkedAt)))[0];
      try { return await readScopeMemory(client, scope, day, { signal, previous }); }
      finally { readDurations.set(key, Date.now() - started); }
    },
    refetchOnWindowFocus: true,
    refetchInterval: () => okfRefreshInterval(scope ? readDurations.get(key) : undefined),
    refetchIntervalInBackground: false,
  };
}
export function useOkfOverview(connection: OkfConnection | null, scope: OkfScope | null) {
  const queries = useQueryClient();
  const [day, setDay] = useState(today);
  useEffect(() => { const timer = setInterval(() => setDay(today()), 1000); return () => clearInterval(timer); }, []);
  return useQuery(okfOverviewQueryOptions(connection,scope,day,queries));
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

/** Kalendářní den podle hodin počítače, ne UTC - „dnes / zítra / po lhůtě“ se po půlnoci neposouvá o den. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
