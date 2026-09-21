/** Pure, portable document naming contract. No discovery and no inferred legal metadata. */
import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { WorkingProfile } from "./profile.ts";

export const NAMING_LIMITS = Object.freeze({ documents: 64, markdownFiles: 32, documentBytes: 100 * 1024 * 1024, markdownBytes: 5 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 });
export class NamingSchemaError extends Error {}
export class NamingConflict extends Error {}
export type NamingMetadata = { date: string; kind?: string; client?: string; description?: string; version?: string };
export type NamingDocument = { id: string; path: string; treatment: "rename-working" | "copy-original-to-drafts"; destinationRole: string; metadata: NamingMetadata };
export type NamingRequestV1 = { schema: "lawoss.document-naming.request/v1"; operationId: string; documents: NamingDocument[]; markdownFiles: string[] };
export type LinkRewrite = { from: string; to: string; kind: "inline" | "reference" | "wikilink" };
export type FilePin = { path: string; sha256: string; bytes: number; physical: string };
export type NamingPlanV1 = {
  schema: "lawoss.document-naming.plan/v1"; operationId: string; fingerprint: string;
  matterRootPhysical: string; rootIdentity: string; request: NamingRequestV1;
  profile: FilePin & { naming: string; roles: Record<string, string> }; memoryProfile: FilePin | null;
  documents: { id: string; treatment: NamingDocument["treatment"]; source: FilePin; target: { path: string; mustBeAbsent: true; parentPhysical: string }; normalizedMetadata: Record<string, string> }[];
  markdown: { source: FilePin; afterSha256: string; rewrites: LinkRewrite[] }[];
  limits: typeof NAMING_LIMITS; totalBytes: number; linkScope: "selected-files-only; unselected links are not verified";
};
export const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const fold = (value: string) => value.normalize("NFC").toUpperCase().toLowerCase();
export function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function fail(message: string): never { throw new NamingSchemaError(message); }
export function exactKeys(value: Record<string, unknown>, keys: string[]): void { if (Object.keys(value).some(k => !keys.includes(k))) fail("Unknown naming field"); }
export function safeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value); }
export function safeRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && value.split("/").every(p => p.length > 0 && p.length <= 240 && p === p.normalize("NFC") && !p.startsWith(".") && p.trim() === p && !/[. ]$/.test(p) && !/[\\<>:"|?*\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(p) && !/^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p));
}
export function validateDate(value: unknown): value is string {
  if (value === "bez-datumu") return true;
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseNamingRequest(value: unknown): NamingRequestV1 {
  if (!object(value)) return fail("Invalid naming request");
  exactKeys(value, ["schema", "operationId", "documents", "markdownFiles"]);
  if (value.schema !== "lawoss.document-naming.request/v1" || !safeId(value.operationId) || !Array.isArray(value.documents) || value.documents.length < 1 || value.documents.length > NAMING_LIMITS.documents || !Array.isArray(value.markdownFiles) || value.markdownFiles.length > NAMING_LIMITS.markdownFiles) return fail("Invalid naming request or selection limit");
  const ids = new Set<string>(), paths = new Set<string>();
  const documents = value.documents.map((d): NamingDocument => {
    if (!object(d)) return fail("Invalid document");
    exactKeys(d, ["id", "path", "treatment", "destinationRole", "metadata"]);
    if (!safeId(d.id) || ids.has(fold(d.id)) || !safeRelativePath(d.path) || paths.has(fold(d.path)) || (d.treatment !== "rename-working" && d.treatment !== "copy-original-to-drafts") || typeof d.destinationRole !== "string" || !/^[a-z][a-z_]*$/.test(d.destinationRole) || (d.treatment === "copy-original-to-drafts" && d.destinationRole !== "drafts") || !object(d.metadata)) return fail("Invalid/duplicate document, portable path or original destination");
    exactKeys(d.metadata, ["date", "kind", "client", "description", "version"]);
    if (!validateDate(d.metadata.date)) return fail("Explicit valid ISO calendar date or bez-datumu required");
    const metadata: NamingMetadata = { date: d.metadata.date };
    for (const key of ["kind", "client", "description", "version"] as const) {
      const field = d.metadata[key]; if (field !== undefined) { if (typeof field !== "string" || !field.trim() || field.length > 240) return fail(`Invalid metadata: ${key}`); metadata[key] = field; }
    }
    ids.add(fold(d.id)); paths.add(fold(d.path));
    return { id: d.id, path: d.path, treatment: d.treatment, destinationRole: d.destinationRole, metadata };
  }).sort((a, b) => order(a.path, b.path));
  const selected = new Set<string>();
  const markdownFiles = value.markdownFiles.map(p => {
    if (!safeRelativePath(p) || !/\.md$/i.test(p) || selected.has(fold(p)) || paths.has(fold(p))) return fail("Invalid/duplicate Markdown or selected document overlap");
    selected.add(fold(p)); return p;
  }).sort(order);
  return { schema: "lawoss.document-naming.request/v1", operationId: value.operationId, documents, markdownFiles };
}
export function normalizeNamingValue(value: string): { input: string; normalized: string } {
  const normalized = value.normalize("NFC").replace(/[\s\\/<>:"|?*`\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, "-").replace(/-+/g, "-").replace(/^[. -]+|[. -]+$/g, "");
  if (!normalized) fail("Metadata becomes empty after normalization");
  return { input: value, normalized };
}
export function normalizedMetadata(metadata: NamingMetadata): Record<string, string> { return Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, normalizeNamingValue(v).normalized])); }
export function renderDocumentName(profile: WorkingProfile, metadata: NamingMetadata, extension: string): string {
  if (!validateDate(metadata.date)) fail("Explicit document date required");
  const normalized = normalizedMetadata(metadata);
  const rendered = profile.naming.replace(/\{(date|kind|client|description|version)\}/g, (_, key: string) => normalized[key] ?? fail(`Missing metadata: ${key}`)) + extension;
  if (!safeRelativePath(rendered) || rendered.includes("/") || Buffer.byteLength(rendered) > 240) fail("Rendered name is not a portable filename");
  return rendered;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort(order).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  return fail("Non-JSON naming value");
}
export function namingFingerprint(value: unknown): string { return hash(canonical(value)); }

/** Conservative link grammar: an affected token outside supported, unambiguous syntax fails closed. */
export function rewriteSelectedMarkdownLinks(markdownPath: string, content: string, moves: readonly { from: string; to: string }[]): { content: string; rewrites: LinkRewrite[] } {
  const referenceIds = [...content.matchAll(/^ {0,3}\[([^\]\n]+)\]:/gm)].map(m => fold(m[1]!.trim().replace(/\s+/g, " ")));
  if (new Set(referenceIds).size !== referenceIds.length && moves.some(move => fold(content).includes(fold(posix.basename(move.from))))) fail("Duplicate reference definitions in affected Markdown");
  const rewrites: LinkRewrite[] = [];
  const edits: { start: number; end: number; text: string }[] = [];
  const covered: { start: number; end: number }[] = [];
  const code = [...content.matchAll(/^---\r?\n[\s\S]*?\n---(?:\r?\n|$)|<!--[\s\S]*?(?:-->|$)|```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`\n]*`+|^(?: {4}|\t).*$/gm)].map(m => ({ start: m.index!, end: m.index! + m[0].length }));
  const patterns: [LinkRewrite["kind"], RegExp][] = [
    ["wikilink", /!?\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g],
    ["inline", /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s()]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g],
    ["reference", /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]+>|[^\s]+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\r?$/gm],
  ];
  for (const [kind, pattern] of patterns) for (const m of content.matchAll(pattern)) {
    const start = m.index!, end = start + m[0].length;
    if (content[start - 1] === "\\") continue;
    if (covered.length > 20000 || rewrites.length > 4096) fail("Selected Markdown exceeds bounded link count");
    if (code.some(c => start < c.end && end > c.start) || covered.some(c => start < c.end && end > c.start)) continue;
    const raw = m[1]!, angle = raw.startsWith("<") && raw.endsWith(">");
    const destination = angle ? raw.slice(1, -1) : raw;
    const split = destination.search(/[?#]/); const pathname = split < 0 ? destination : destination.slice(0, split), suffix = split < 0 ? "" : destination.slice(split);
    if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|#)/.test(pathname)) { covered.push({ start, end }); continue; }
    let decoded: string; try { decoded = decodeURIComponent(pathname); } catch { continue; }
    if (decoded.includes("\\")) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(markdownPath), decoded));
    const matches = moves.filter(move => move.from === resolved || (kind === "wikilink" && move.from === decoded));
    const unique = [...new Set(matches)];
    if (unique.length > 1) fail("Ambiguous affected wikilink");
    if (unique.length === 0) {
      // Obsidian basename/extensionless lookup and case-insensitive matches cannot be proven without discovery.
      if (kind === "wikilink" && moves.some(move => fold(posix.basename(move.from, posix.extname(move.from))) === fold(posix.basename(decoded, posix.extname(decoded))))) fail("Ambiguous affected wikilink; use an exact relative path");
      if (moves.some(move => fold(move.from) === fold(resolved))) fail("Ambiguous affected link case");
      covered.push({ start, end }); continue;
    }
    const move = unique[0]!;
    let next = kind === "wikilink" && decoded === move.from && decoded !== resolved ? move.to : posix.relative(posix.dirname(markdownPath), move.to);
    if (pathname.startsWith("./") && !next.startsWith(".")) next = `./${next}`;
    if (pathname.includes("%") || (kind !== "wikilink" && !angle)) next = next.split("/").map(encodeURIComponent).join("/");
    next += suffix;
    const replacement = angle ? `<${next}>` : next;
    const offset = m[0].indexOf(raw, kind === "reference" ? m[0].indexOf(":") + 1 : kind === "inline" ? m[0].indexOf("](") + 2 : 0);
    edits.push({ start: start + offset, end: start + offset + raw.length, text: replacement });
    covered.push({ start, end }); rewrites.push({ from: destination, to: next, kind });
  }
  let residual = content; for (const c of covered.sort((a, b) => b.start - a.start)) residual = residual.slice(0, c.start) + " ".repeat(c.end - c.start) + residual.slice(c.end);
  let decodedResidual = residual; try { decodedResidual = decodeURIComponent(residual); } catch { /* raw token check remains */ }
  if (moves.some(move => fold(decodedResidual).includes(fold(posix.basename(move.from))))) fail("Affected path in unsupported/ambiguous Markdown syntax");
  let result = content; for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return { content: result, rewrites: rewrites.sort((a, b) => order(a.from, b.from) || order(a.to, b.to) || order(a.kind, b.kind)) };
}
