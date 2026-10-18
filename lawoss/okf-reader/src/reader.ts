/** Portable read-only orchestration. Only the host adapter touches storage. */
import { readManualStatus } from '../../okf-pamat/src/manual-status.ts';
import { addDays, buildOverview, type MatterInput, type Overview } from '../../okf/read.ts';
import type { OkfRecord } from '../../okf-pamat/src/record.ts';
import { parseFrontmatter } from '../../okf/src/frontmatter.ts';
import { looksLikeMatterName } from '../../okf/src/onboarding/suggest-patterns.ts';
import { parseRecord, parseFrontmatter as parseMemoryFrontmatter } from '../../okf-pamat/src/record.ts';
import { validateStore } from '../../okf-pamat/src/validate.ts';
import { today } from './time.ts';
export type OkfEntry = { name: string; kind: 'file' | 'dir'; path: string };
export type OkfReadSource = {
  list(path: string): Promise<{ entries: OkfEntry[]; truncated: boolean }>;
  readText(path: string): Promise<string>;
};
export type OkfScopeRecords = { path: string; level: 'matter' | 'client' | 'office'; records: OkfRecord[]; recordFiles: Record<string, string> };
export type ReadProblem = { path: string; message: string; kind?: "validation"; scope?: "matter" | "client" | "office" };
export type OkfReadResult = Overview & {
  problems: ReadProblem[];
  /** Workspace má viac vecí než `MAX_MATTERS`; prehľad je čiastočný. */
  truncated: boolean;
  /** Prečítané záznamy po veciach — detail veci ich potrebuje, prehľad ich ignoruje. */
  inputs: MatterInput[];
  /** Priečinky s kartou klienta (`client.md`/`klient.md`) vrátane klientov bez vecí; názov z karty. */
  clients?: OkfClient[];
  scopes?: OkfScopeRecords[];
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
export const CLIENT_CARDS = ["client.md", "klient.md"];
/** Klient ve tvaru kanceláře `AK/<písmeno>/<klient>` (vault bez karet a bez `Spisy/`). */
const AK_CLIENT = /^AK\/[^/]+\/[^/]+$/;
/** Pracovní podsložky uvnitř klienta nebo věci - nejsou to samostatné věci. */
const WORK_DIRS = new Set(["DS", "Prilohy", "Přílohy", "research", "drafts", "final", "analysis", "sources", "qa", "logs"]);
const isWorkDir = (name: string): boolean => WORK_DIRS.has(name) || /^\d{2}_/.test(name) || name.startsWith("_");
const RESERVED = new Set(["index.md", "log.md", "INDEX.md"]);
export const missing = (e: unknown): boolean => /(?:\b404\b|\bENOENT\b|not[_ ]found)/i.test(message(e));
export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `Promise.all` s hornou hranicou súbežnosti; výsledky v poradí vstupu. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
export async function readOkfRoot(
  source: OkfReadSource,
  todayIso: string = today(),
  root = "",
  independentScopes = false,
): Promise<OkfReadResult> {
  const problems: ReadProblem[] = [];
  let truncated = false;
  type Listing = Awaited<ReturnType<OkfReadSource["list"]>>;
  const cache = new Map<string, Promise<Listing["entries"]>>();
  const list = (path: string, optional = false): Promise<Listing["entries"]> => {
    let pending = cache.get(path);
    if (!pending) {
      pending = source.list(path).then((result) => {
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
      // Priamy podpriečinok klienta s kartou pomenovaný ako vec (`2025-01 Spor`, spisová značka) je vec aj bez
      // karty; rovnaký vzor ako rozpoznanie a roztriedenie (suggest-patterns.ts), D1 2026-10-09.
      } else await discover(child.path, hasClientCard && !isWorkDir(child.name) && looksLikeMatterName(child.name), depth + 1, clientFolder);
    }
  };
  await discover(root);

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
      const title = parseFrontmatter((await source.readText(childPath(clientPath, card.name))))?.title;
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
            const record = parseRecord((await source.readText(file.path)));
            if (record.okf !== 1) throw new Error(`Unsupported OKF record version: ${record.okf}`);
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
        const fm = parseFrontmatter((await source.readText(childPath(path, card))));
        if (!fm) throw new Error("Karta nemá platný frontmatter.");
        input.cardFrontmatter = fm;
      } catch (e) { problems.push({ path: childPath(path, card), message: message(e) }); }
    }
    if (entries.some((e) => e.name === "VSTUPY.md" && e.kind === "file")) {
      try { input.intake = (await source.readText(childPath(path, "VSTUPY.md"))); }
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
            const config = parseMemoryFrontmatter((await source.readText(`${officePath}/okf.config`)));
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
        input.inheritedIntakes = [{ content: (await source.readText(intakePath)), path: intakePath, scope: "client" }];
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
      try { input.manualStatus = readManualStatus((await source.readText(statusPath)), input.records, todayIso); }
      catch (error) { problems.push({ path: statusPath, message: message(error) }); }
    }
    return input;
  });
  // Súbežné čítanie pridáva problémy v náhodnom poradí; zoradené sa nemenia, kým sa nezmenia súbory
  // (inak by zdieľanie štruktúry v react-query hlásilo zmenu a pohľad by sa zbytočne prekreslil).
  // Klient bez vecí je stále klient: Klienti a veci ho ukážu (D1 2026-10-04). Poradie podľa cesty kvôli zdieľaniu štruktúry.
  if (independentScopes) {
    for (const clientPath of clientPaths) await readBundle(clientPath);
    const parts = root.split('/').filter(Boolean);
    for (let i = parts.length; i >= 0; i--) {
      const ancestor = parts.slice(0, i).join('/');
      const office = (await list(ancestor)).find(e => e.kind === 'dir' && ['Office', '_kancelaria'].includes(e.name));
      if (office) { await readBundle(office.path); break; }
    }
  }
  const scopes: OkfScopeRecords[] = [];
  for (const [path, pending] of bundles) {
    const bundle = await pending;
    const level = /(^|\/)(Office|_kancelaria)$/.test(path) ? 'office' : paths.includes(path) ? 'matter' : 'client';
    scopes.push({ path, level, records: bundle.records, recordFiles: bundle.files });
  }
  if (independentScopes) {
    // Matter errors already use the complete inherited context above. Add warnings
    // from that same context; a per-directory validator would invent broken links.
    for (const input of matters) {
      for (const finding of validateStore(input.records, { today: todayIso })) {
        if (finding.severity !== 'warning') continue;
        problems.push({ path: input.recordFiles?.[finding.recordId] ?? input.path, message: `${finding.code}: ${finding.message}`, kind: 'validation' });
      }
    }
    const covered = new Set(matters.flatMap(input => input.scopePaths ?? []));
    for (const scope of scopes) {
      if (covered.has(scope.path)) continue;
      const inherited = scope.level === 'office' ? [] : scopes.filter(s => s.level === 'office').flatMap(s => s.records);
      for (const finding of validateStore([...scope.records, ...inherited], { today: todayIso })) {
        const file = scope.recordFiles[finding.recordId] ?? scopes.find(s => s.recordFiles[finding.recordId])?.recordFiles[finding.recordId] ?? scope.path;
        problems.push({ path: file, message: `${finding.code}: ${finding.message}`, kind: 'validation', scope: scope.level });
      }
    }
  }
  const clients = (await mapLimit([...clientPaths].sort(), CONCURRENCY, async (clientPath): Promise<OkfClient> => {
    const title = await clientTitle(clientPath);
    return title ? { path: clientPath, title } : { path: clientPath };
  }));
  problems.sort((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
  return { ...buildOverview(matters, todayIso), problems, truncated, inputs: matters, clients, scopes };
}
