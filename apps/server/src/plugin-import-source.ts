import { createHash } from "node:crypto";
import { ApiError } from "./errors.js";
import { parseClaudePluginSource } from "./claude-plugin-bundle.js";

async function bytes(response: Response, limit: number): Promise<Uint8Array> {
  if (response.status === 429) throw new ApiError(429, "plugin_source_rate_limited", "GitHub is rate limiting this download. Try again later, or import a local copy of the plugin folder or archive.");
  if (!response.ok) throw new ApiError(400, "plugin_source_unavailable", `The plugin source could not be read (${response.status}). Check repository access and its revision.`);
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(400, "plugin_source_empty", "The repository returned an empty plugin package.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ApiError(400, "plugin_source_too_large", "The plugin source exceeds the download limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

const snapshots = new Map<string, { bytes: Uint8Array; expires: number }>();
const downloading = new Map<string, Promise<Uint8Array>>();
async function cachedSnapshot(key: string, download: () => Promise<Uint8Array>) {
  for (const [id, entry] of snapshots) if (entry.expires < Date.now()) snapshots.delete(id);
  const cached = snapshots.get(key);
  if (cached) return cached.bytes;
  const pending = downloading.get(key);
  if (pending) return pending;
  const work = download();
  downloading.set(key, work);
  try {
    const bytes = await work;
    snapshots.set(key, { bytes, expires: Date.now() + 5 * 60_000 });
    while ([...snapshots.values()].reduce((sum, item) => sum + item.bytes.length, 0) > 128 * 1024 * 1024 || snapshots.size > 10) snapshots.delete(snapshots.keys().next().value || "");
    return bytes;
  } finally { downloading.delete(key); }
}

/** Download one immutable snapshot. No plugin code or install scripts are executed. */
export async function githubPluginSource(url: string, explicitRef?: string, directory?: string) {
  const parsed = parseClaudePluginSource(url);
  const origin = process.env.LEGALWORK_GITHUB_API_BASE?.trim() || "https://api.github.com";
  const token = origin === "https://api.github.com" ? process.env.GITHUB_TOKEN || process.env.GH_TOKEN : undefined;
  const headers = { "User-Agent": "legalwork-server", Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const request = async (path: string) => {
    const response = await fetch(`${origin}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}${path ? `/${path}` : ""}`, { headers, signal: AbortSignal.timeout(30_000), redirect: "manual" });
    const value: unknown = JSON.parse(new TextDecoder().decode(await bytes(response, 1024 * 1024)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "plugin_source_invalid", "The repository returned invalid metadata.");
    return Object.fromEntries(Object.entries(value));
  };
  const explicitDirectory = directory ?? (explicitRef && parsed.treeSegments?.join("/").startsWith(`${explicitRef}/`) ? parsed.treeSegments.join("/").slice(explicitRef.length + 1) : explicitRef && parsed.treeSegments?.join("/") === explicitRef ? null : parsed.dir);
  const candidates = explicitRef ? [{ ref: explicitRef, dir: explicitDirectory }] : parsed.treeSegments?.length ? parsed.treeSegments.map((_, index) => ({ ref: parsed.treeSegments?.slice(0, index + 1).join("/"), dir: parsed.treeSegments?.slice(index + 1).join("/") || null })) : [{ ref: undefined, dir: null }];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    try {
      const ref = candidate.ref || (await request("")).default_branch;
      if (typeof ref !== "string" || !ref) throw new Error("The repository has no default branch.");
      const commit: unknown = await request(`commits/${encodeURIComponent(ref)}`);
      if (!commit || typeof commit !== "object" || !("sha" in commit) || typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error("The source did not resolve to a commit.");
      const key = createHash("sha256").update(JSON.stringify([origin, parsed.owner, parsed.repo, commit.sha, token])).digest("hex");
      const snapshot = await cachedSnapshot(key, async () => {
        const response = await fetch(`${origin}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/zipball/${commit.sha}`, { headers, signal: AbortSignal.timeout(30_000), redirect: "manual" });
        let archive = response;
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const destination = new URL(response.headers.get("location") || "", origin);
          if (destination.protocol !== "https:" || destination.hostname !== "codeload.github.com") throw new Error("The repository returned an unsupported archive redirect.");
          archive = await fetch(destination, { signal: AbortSignal.timeout(30_000), redirect: "error" });
        }
        return bytes(archive, 64 * 1024 * 1024);
      });
      return { bytes: snapshot, location: `https://github.com/${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`, ref, revision: commit.sha, directory: candidate.dir || "" };
    } catch (error) { if (index === candidates.length - 1) throw error; }
  }
  throw new ApiError(400, "plugin_source_unavailable", "Choose a valid GitHub repository and revision.");
}
