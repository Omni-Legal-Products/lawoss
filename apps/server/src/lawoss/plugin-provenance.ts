/**
 * LAWOSS: pôvod nainštalovaného pluginu pre budúce aktualizácie z LAWOSS Marketplace
 * (rozhodnutie MČ 5. 10. 2026). Pri inštalácii z GitHubu sa zapíše repozitár, pripnutý
 * ref (SHA) a verzia z `plugin.json`; pri každom súbore, ktorý server zapíše do workspace,
 * SHA-256 zapísaného obsahu. Neskoršia aktualizácia tak vie povedať, či je k dispozícii
 * novšia verzia (iný ref alebo verzia) a či advokát súbor medzitým upravil (iný hash),
 * a upravený súbor neprepíše bez opýtania, rovnako ako skilly OKF.
 *
 * Polia sú voliteľné: staršie záznamy a inštalácie z firemného marketplace ich nemajú.
 * Nič tu nevolá sieť.
 */
import { createHash } from "node:crypto";

export type PluginProvenance = {
  source: { owner: string; repo: string; ref: string; dir: string | null };
  version: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Pole `provenance` pre záznam pluginu, len ak ho inštalácia poznala. */
export function withProvenance(provenance: PluginProvenance | null | undefined): { provenance?: PluginProvenance } {
  return provenance ? { provenance } : {};
}

/** Pole `contentSha256` pre záznam súboru, len pri obsahu zapísanom do workspace. */
export function withContentHash(content: string | null | undefined): { contentSha256?: string } {
  return typeof content === "string" ? { contentSha256: contentSha256(content) } : {};
}

/** Načíta uložený pôvod; poškodený alebo neúplný záznam sa vynechá. */
export function readProvenance(value: Record<string, unknown>): { provenance?: PluginProvenance } {
  const raw = value.provenance;
  if (!isRecord(raw) || !isRecord(raw.source)) return {};
  const owner = text(raw.source.owner);
  const repo = text(raw.source.repo);
  const ref = text(raw.source.ref);
  if (!owner || !repo || !ref) return {};
  return { provenance: { source: { owner, repo, ref, dir: text(raw.source.dir) }, version: text(raw.version) } };
}

export function readContentHash(file: Record<string, unknown>): { contentSha256?: string } {
  const hash = text(file.contentSha256);
  return hash && /^[a-f0-9]{64}$/.test(hash) ? { contentSha256: hash } : {};
}
