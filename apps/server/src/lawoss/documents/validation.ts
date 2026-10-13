/** Strict RFC-style quoting with semicolon separators and multiline fields. */
export function parseCsv(text: string): string[][] {
 const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false;
 for (let i=0;i<text.length;i++) {
  const c=text[i];
  if (quoted) { if(c==='"') { if(text[i+1]==='"') { field+='"'; i++; } else { quoted=false; closed=true; } } else field+=c; continue; }
  if(c==='"') { if(field || closed) throw new Error("Unexpected CSV quote."); quoted=true; }
  else if(c===';') { row.push(field); field=""; closed=false; }
  else if(c==='\n' || c==='\r') { if(c==='\r' && text[i+1]==='\n') i++; row.push(field); rows.push(row); row=[]; field=""; closed=false; }
  else { if(closed) throw new Error("Text after closing CSV quote."); field+=c; }
 }
 if(quoted) throw new Error("Unclosed CSV quote."); if(field || row.length || closed) { row.push(field); rows.push(row); } return rows;
}
export const CSV_HEADER = ["soubor","id_dokumentu","zdroj_url","datum_z_dokumentu","typ_dokumentu","kratky_obsah","citelnost"];
export function serializeCsv(rows: string[][]): string { return rows.map(row=>row.map(field=>/[;"\r\n]/.test(field)?`"${field.replaceAll('"','""')}"`:field).join(";")).join("\n")+"\n"; }
export type ValidationIssue = { code: string; path?: string; row?: number; message: string };
export type ValidatedOutput = { path: string; hash: string | null; verified: boolean; owned: boolean };
export type ValidationResult = { valid: boolean; issues: ValidationIssue[]; outputs: ValidatedOutput[]; legalApproval: false; instruction: string };
