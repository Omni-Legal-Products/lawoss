import { existsSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { opendir, realpath, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import {
  matchesSearch,
  searchExcerpt,
  type ContentSearchResponse,
  type ContentSearchResult,
} from "./search-schema.js";
import {
  openSqliteReadonly,
  MANAGED_ENGINE_DB_FILENAME,
} from "./managed-opencode-db.js";
import { resolveOpencodeDbPath } from "./opencode-db.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "./types.js";
import {
  CORPUS_EXTENSIONS,
  extractCorpusText,
  type CorpusText,
} from "./corpus/extract.js";
import { documentMatches } from "./corpus/passages.js";
import type { DocumentPreparation } from "./document-preparation/service.js";
import { within } from "./reviews/storage.js";
import { viewerProtectedPaths } from "./lawoss/filesystem-boundary.js";
import { fileNameMatches } from "./lawoss/file-name-match.js";

const RESULT_LIMIT = 60;

export function localSessionDatabasePath(config: ServerConfig) {
  const managedPath = join(
    runtimeStorageDir(config),
    MANAGED_ENGINE_DB_FILENAME,
  );
  return !process.env.OPENCODE_DB?.trim() && existsSync(managedPath)
    ? managedPath
    : resolveOpencodeDbPath();
}

/** Read the engine's own local transcripts, including messages older than the UI's history window. */
export async function searchSessionContents(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  query: string,
  signal: AbortSignal,
): Promise<ContentSearchResponse> {
  const dbPath = localSessionDatabasePath(config);
  if (!existsSync(dbPath))
    throw new Error("The local session database is unavailable.");
  const db = await openSqliteReadonly(dbPath);
  try {
    const root =
      workspace.opencode?.directory || workspace.directory || workspace.path;
    const canonicalRoot = await realpath(root).catch(() => resolve(root));
    // Released 2.1.4 retains legacy tables, but only these native tables
    // contain new chats. Never fall back to a stale v1 transcript silently.
    const stored = (path: string) =>
      process.platform === "win32" ? path.replaceAll("\\", "/") : path;
    const sessions = db.all(
      `SELECT id,title,time_updated FROM session_v2
      WHERE directory IN (?,?) AND (time_archived IS NULL OR time_archived=0) ORDER BY time_updated DESC`,
      [stored(root), stored(canonicalRoot)],
    );
    const found = new Map<string, ContentSearchResult>();
    const add = (
      session: Record<string, unknown>,
      excerpt = "",
      messageId?: string,
    ) => {
      const id = String(session.id);
      found.set(id, {
        kind: "sessions",
        id,
        workspaceId: workspace.id,
        title: typeof session.title === "string" ? session.title : "",
        excerpt: searchExcerpt(excerpt, query),
        updatedAt: Number(session.time_updated),
        ...(messageId ? { messageId } : {}),
      });
    };
    for (const session of sessions) {
      if (
        matchesSearch(
          typeof session.title === "string" ? session.title : "",
          query,
        )
      )
        add(session);
      if (found.size > RESULT_LIMIT) break;
    }
    let scanned = 0, budgetHit = false;
    // 🟡 LAWOSS #465: prepis chatov najviac 3 s na požiadavku, potom neúplný výsledok („spresnite“).
    const sessionDeadline = Date.now() + 3000;
    for (const session of sessions) {
      signal.throwIfAborted();
      if (found.size > RESULT_LIMIT) break;
      if (Date.now() > sessionDeadline) { budgetHit = true; break; }
      if (found.has(String(session.id))) continue;
      // Stream complete public prose, excluding synthetic messages, tool
      // results and reasoning. Native user.text includes model reminders;
      // only the explicitly attested visibleText is searchable when present.
      const parts = db.iterate(
        `SELECT m.id AS message_id,
        CASE WHEN m.type='user' THEN
          CASE WHEN json_type(m.data,'$.metadata.legalworkPrompt.visibleText')='text'
            THEN json_extract(m.data,'$.metadata.legalworkPrompt.visibleText')
            ELSE json_extract(m.data,'$.text') END
        ELSE (SELECT group_concat(json_extract(c.value,'$.text'),char(10))
          FROM json_each(m.data,'$.content') c
          WHERE json_extract(c.value,'$.type')='text') END AS text
        FROM session_message m WHERE m.session_id=? AND m.type IN ('user','assistant') ORDER BY m.seq DESC`,
        [String(session.id)],
      );
      for (const part of parts) {
        if (++scanned % 50 === 0) {
          await setImmediate();
          signal.throwIfAborted();
        }
        if (typeof part.text === "string" && matchesSearch(part.text, query)) {
          add(session, part.text, String(part.message_id));
          break;
        }
      }
    }
    return {
      items: [...found.values()].slice(0, RESULT_LIMIT),
      limited: found.size > RESULT_LIMIT || budgetHit,
    };
  } finally {
    db.close();
  }
}

// Background preparation survives a changed query. Only two files per server
// are prepared at once; polling reuses both these results and the OCR disk cache.
type FileEntry = {
  revision: string;
  value?: CorpusText;
  error?: string;
  pending: boolean;
  touched: number;
  retryRequested?: boolean;
};
// 🟡 LAWOSS #474: files a search could not start yet wait here and are prepared after the response,
// two at a time, so preparation no longer advances only while the palette keeps polling.
type QueuedFile = { root: string; path: string; revision: string; retry: boolean };
type PreparationState = { cache: Map<string, FileEntry>; queue: Map<string, QueuedFile>; idle: Array<() => void> };
const states = new WeakMap<DocumentPreparation, PreparationState>();
const CONCURRENCY = 2;
const QUEUE_LIMIT = 2000;
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "__pycache__",
]);
function preparationState(preparation: DocumentPreparation) {
  let state = states.get(preparation);
  if (!state) {
    state = { cache: new Map(), queue: new Map(), idle: [] };
    states.set(preparation, state);
  }
  return state;
}
const running = (state: PreparationState) =>
  [...state.cache.values()].filter((entry) => entry.pending).length;

/** Resolves once no file of this server is being prepared or waiting (#474). */
export function whenPreparationIdle(preparation: DocumentPreparation): Promise<void> {
  const state = preparationState(preparation);
  if (!state.queue.size && !running(state)) return Promise.resolve();
  return new Promise((resolve) => state.idle.push(resolve));
}

function documentEntry(
  preparation: DocumentPreparation,
  root: string,
  path: string,
  revision: string,
  retry: boolean,
) {
  const state = preparationState(preparation);
  const key = join(root, path);
  const prior = state.cache.get(key);
  if (prior?.revision === revision) {
    prior.touched = Date.now();
    if (retry && !prior.pending && (prior.error || !prior.value?.complete))
      prior.retryRequested = true;
    if (prior.pending || !prior.retryRequested) return prior;
  }
  const again = retry || (prior?.revision === revision && prior.retryRequested === true);
  if (running(state) >= CONCURRENCY) {
    if (state.queue.has(key) || state.queue.size < QUEUE_LIMIT)
      state.queue.set(key, { root, path, revision, retry: again });
    return;
  }
  state.queue.delete(key);
  return prepare(preparation, state, { root, path, revision, retry: again });
}

function prepare(preparation: DocumentPreparation, state: PreparationState, file: QueuedFile) {
  const { cache } = state;
  let characters = [...cache.values()].reduce(
    (total, entry) => total + (entry.value?.text.length ?? 0),
    0,
  );
  for (const [id, entry] of [...cache.entries()].sort(
    (a, b) => a[1].touched - b[1].touched,
  )) {
    if (cache.size < 2000 && characters <= 24_000_000) break;
    if (entry.pending) continue;
    cache.delete(id);
    characters -= entry.value?.text.length ?? 0;
  }
  const entry: FileEntry = { revision: file.revision, pending: true, touched: Date.now() };
  cache.set(join(file.root, file.path), entry);
  void extractCorpusText(
    file.root,
    file.path,
    preparation,
    AbortSignal.timeout(5 * 60_000),
    {
      retry: file.retry,
      // 🟡 LAWOSS #465: bez výslovného zopakovania hľadanie skeny nevykresľuje (corpus/extract.ts).
      scans: file.retry ? "prepare" : "native-only",
    },
  )
    .then(
      (value) => {
        entry.value = value;
      },
      (error) => {
        entry.error =
          error instanceof Error ? error.message : "Could not read this file.";
      },
    )
    .finally(() => {
      entry.pending = false;
      drain(preparation, state);
    });
  return entry;
}

function drain(preparation: DocumentPreparation, state: PreparationState) {
  for (const [key, file] of state.queue) {
    if (running(state) >= CONCURRENCY) return;
    state.queue.delete(key);
    const current = state.cache.get(key);
    if (current?.revision === file.revision && (current.pending || !file.retry)) continue;
    prepare(preparation, state, file);
  }
  if (!state.queue.size && !running(state)) for (const resolve of state.idle.splice(0)) resolve();
}

export async function searchFileContents(
  workspace: WorkspaceInfo,
  query: string,
  signal: AbortSignal,
  preparation: DocumentPreparation,
  scope: TokenScope,
  retry = false,
): Promise<ContentSearchResponse> {
  const root = await realpath(workspace.path);
  // 🟡 LAWOSS: viewer nesmie nájsť chránenú konfiguráciu ani jej aliasy, ani podľa názvu, ani úryvkom.
  const isProtected = scope === "viewer" ? await viewerProtectedPaths(root) : () => false;
  const items: ContentSearchResult[] = [],
    issues: Array<{ path: string; reason: string }> = [];
  let visited = 0,
    skipped = 0,
    incomplete = 0,
    preparing = 0,
    limited = false;
  const deadline = Date.now() + 2500;
  // 🟡 LAWOSS #465: po čase na obsah sa prechádzanie nezastaví, len hľadá ďalej podľa názvu (bez prípravy obsahu),
  // spolu najviac 4 s; každých 64 položiek prepustí iné požiadavky servera (žiadne blokovanie slučky udalostí).
  const nameDeadline = deadline + 1500;
  const nameItems: ContentSearchResult[] = [], pathItems: ContentSearchResult[] = [];
  let stopped = false;
  const issue = (path: string, reason: string) => {
    if (issues.length < 20) issues.push({ path, reason });
  };
  async function visit(directory: string): Promise<void> {
    signal.throwIfAborted();
    const entries = await opendir(directory);
    for await (const entry of entries) {
      signal.throwIfAborted();
      if (++visited > 20_000 || Date.now() > nameDeadline) {
        limited = stopped = true;
        break;
      }
      if (visited % 64 === 0) { await setImmediate(); signal.throwIfAborted(); }
      const contentOpen = Date.now() <= deadline;
      if (!contentOpen) limited = true;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name))
          await visit(path).catch((error) => {
            if (signal.aborted) throw error;
            skipped++;
          });
        if (stopped) break;
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = relative(root, path).split("\\").join("/");
      // Názov súboru má prednosť; zhoda len v ceste (napr. názov priečinka klienta) ide až za obsah.
      const fileName = basename(path);
      const nameMatch = matchesSearch(fileName, query) || fileNameMatches(fileName, query);
      const pathMatch = nameMatch || matchesSearch(relativePath, query) || fileNameMatches(relativePath, query);
      if (!contentOpen && !pathMatch) continue;
      try {
        const canonicalPath = await realpath(path);
        if (!within(root, canonicalPath)) continue;
        // Before the preparation cache, which all roles share.
        if (isProtected(canonicalPath, relativePath)) continue;
        const info = await stat(canonicalPath);
        let source: CorpusText | undefined;
        if (!contentOpen) {
          // Len zhoda názvu (overená pred realpath), obsah sa už nepripravuje.
        } else if (CORPUS_EXTENSIONS.has(extname(path).toLowerCase())) {
          if (info.size > 64 * 1024 * 1024) {
            skipped++;
            issue(relativePath, "File exceeds the 64 MiB preparation limit.");
          } else {
            const document = documentEntry(
              preparation,
              root,
              relativePath,
              `${info.mtimeMs}:${info.ctimeMs}:${info.size}`,
              retry,
            );
            if (!document || document.pending) preparing++;
            else if (document.error) {
              skipped++;
              issue(relativePath, document.error);
            } else if (document.value) {
              source = document.value;
              if (!source.complete) {
                incomplete++;
                issue(
                  relativePath,
                  source.issue ?? "Some regions could not be read.",
                );
              }
            }
          }
        } else {
          skipped++;
          issue(
            relativePath,
            "Content search is unavailable for this file type. Its name is still searchable.",
          );
        }
        const matches = source
          ? documentMatches(source, relativePath, query)
          : { sources: [], sourcesLimited: false };
        if (!pathMatch && !matches.sources.length) continue;
        (nameMatch ? nameItems : matches.sources.length ? items : pathItems).push({
          kind: "files",
          id: relativePath,
          workspaceId: workspace.id,
          path: relativePath,
          title: basename(path),
          excerpt: matches.sources[0]?.quote ?? relativePath,
          updatedAt: info.mtimeMs,
          ...matches,
          incomplete: source ? !source.complete : undefined,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        skipped++;
        issue(
          relativePath,
          error instanceof Error ? error.message : "Could not read this file.",
        );
      }
    }
  }
  await visit(root);
  // 🟡 LAWOSS #465: zhody názvu pred zhodami obsahu, aby ich limit výsledkov neodrezal.
  items.unshift(...nameItems);
  items.push(...pathItems);
  return {
    items: items.slice(0, RESULT_LIMIT),
    limited: limited || items.length > RESULT_LIMIT,
    skipped,
    preparing,
    incomplete,
    issues,
    retryable: incomplete > 0 || skipped > 0,
  };
}
