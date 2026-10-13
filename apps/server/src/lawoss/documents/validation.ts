import { z } from "zod";
/** Strict RFC-style quoting with semicolon separators and multiline fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        }
        else {
          quoted = false;
          closed = true;
        }
      }
      else
        field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed)
        throw new Error("Unexpected CSV quote.");
      quoted = true;
    }
    else if (c === ';') {
      row.push(field);
      field = "";
      closed = false;
    }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n')
        i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closed = false;
    }
    else {
      if (closed)
        throw new Error("Text after closing CSV quote.");
      field += c;
    }
  }
  if (quoted)
    throw new Error("Unclosed CSV quote.");
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
export const CSV_HEADER = ["soubor", "id_dokumentu", "zdroj_url", "datum_z_dokumentu", "typ_dokumentu", "kratky_obsah", "citelnost"];
export function serializeCsv(rows: string[][]): string { return rows.map(row => row.map(field => /[;"\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field).join(";")).join("\n") + "\n"; }
export type ValidationIssue = {
  code: string;
  path?: string;
  row?: number;
  message: string;
};
export type ValidatedOutput = {
  path: string;
  hash: string | null;
  verified: boolean;
  owned: boolean;
};
export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
  outputs: ValidatedOutput[];
  legalApproval: false;
  instruction: string;
};
export const outputLanguageSchema = z.enum(["cs", "sk", "en"]);
export const identitySchema = z.object({
  caseNumber: z.string().max(200).nullable(),
  company: z.string().max(500).nullable(),
  sourceUrl: z.string().max(2048).nullable(),
  project: z.string().max(500),
});
export const summarySchema = z.object({
  identity: identitySchema,
  outputLanguage: outputLanguageSchema,
  sourceKind: z.enum(["isir", "workspace"]).optional(),
  sources: z.array(z.object({
    file: z.string().max(4096),
    documentId: z.string().max(200),
    url: z.string().max(2048),
    date: z.string().max(100),
    type: z.string().max(200),
    summary: z.string().max(12000),
    coverage: z.unknown(),
  })).max(20),
  legalApproval: z.literal(false).optional(),
});
export const sidecarSchema = identitySchema.extend({
  sourceUrl: z.string().url().max(2048).nullable(),
  outputLanguage: outputLanguageSchema,
}).strict();
export type SummaryData = z.infer<typeof summarySchema>;
export type OutputIdentity = z.infer<typeof identitySchema>;
export const SUMMARY_LABELS = {
  cs: { summary: "Souhrn", unknown: "Nezjištěno", coverage: "Úplnost zpracování", complete: "Úplné", partial: "Neúplné" },
  sk: { summary: "Súhrn", unknown: "Nezistené", coverage: "Úplnosť spracovania", complete: "Úplné", partial: "Neúplné" },
  en: { summary: "Summary", unknown: "Unknown", coverage: "Extraction coverage", complete: "Complete", partial: "Incomplete" },
};
export function summaryIdentityHeader(data: SummaryData): string {
  const label = SUMMARY_LABELS[data.outputLanguage];
  return `# ${label.summary}\n\n${data.identity.company ?? label.unknown} — ${data.identity.caseNumber ?? label.unknown}\n\n`;
}
/** One renderer defines both the exported and inspected visible provenance. */
export function renderSummaryVisible(data: SummaryData): string {
  const label = SUMMARY_LABELS[data.outputLanguage];
  const sections = data.sources.map(source => {
    const extracted = z.object({ complete: z.boolean() }).safeParse(source.coverage);
    const complete = extracted.success && extracted.data.complete;
    const reference = source.url ? `[${source.documentId}](${source.url})` : `${label.unknown} (${source.documentId})`;
    return `## ${source.file}\n\n${source.summary}\n\n${reference}\n\n${label.coverage}: ${complete ? label.complete : label.partial}`;
  }).join("\n\n");
  return `${summaryIdentityHeader(data)}${sections}\n\n`;
}
export function parseSavedSummary(path: string, text: string): {
  data: SummaryData;
  visible: string | null;
} {
  if (!path.endsWith(".md"))
    return { data: summarySchema.parse(JSON.parse(text)), visible: null };
  const start = text.lastIndexOf("```json\n");
  const end = text.lastIndexOf("```");
  if (start < 0 || end < start + 8)
    throw new Error("Summary machine block is missing.");
  // Include text after the block: extra displayed references must not be ignored.
  const visible = text.slice(0, start) + text.slice(end + 3).replace(/^\n?/, "");
  return { data: summarySchema.parse(JSON.parse(text.slice(start + 8, end))), visible };
}
export function summaryRows(data: SummaryData): string[][] {
  return [CSV_HEADER, ...data.sources.map(source => [source.file, source.documentId, source.url, source.date, source.type, source.summary, JSON.stringify(source.coverage)])];
}
