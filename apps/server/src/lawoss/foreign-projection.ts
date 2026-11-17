/**
 * LAWOSS #509: projekcia `.opencode/opencode.json`, ktorú vygenerovala iná inštalácia LegalWork/LAWOSS.
 *
 * Ten istý priečinok klienta môžu otvoriť dve inštalácie (iný počítač nad NAS/cloudom, iný profil, reinštalácia).
 * Každá zapíše projekciu s odkazmi do svojej súkromnej knižnice reťazcov (`<profil>/…/native-config-strings/<sha256>.txt`).
 * Taký súbor nie je úprava advokáta: má hlavičku generátora, presne jeho formát a každý reťazec je len postupnosť
 * odkazov `{file:…}`/`{env:…}` s aspoň jedným odkazom do (cudzej) knižnice.
 *
 * Bezpečnosť: odkazy cudzej projekcie sa len rozpoznajú regulárnym výrazom. Nič sa podľa nich nečíta ani nerieši;
 * súbor sa po zhode tvaru (`sameShape` v `engine-project.ts`) nahradí vlastnou projekciou a jeho bajty sa uložia
 * len do súkromného archívu tejto inštalácie.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeStorageDir } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { GENERATED_PROJECTION_HEADER } from "./outside-stale-projection.js";

const LIBRARY = "native-config-strings";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const TOKENS = /^(?:\s*\{(?:env|file):[^}]+\})+\s*$/;
/** `{file:<absolute library>/<sha256>.txt}`, POSIX or Windows separators. */
const LIBRARY_FILE = /^(.+[\\/]native-config-strings)[\\/]([0-9a-f]{64})\.txt$/;

function strings(value: unknown, found: string[]): string[] {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, found);
  else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, found);
  return found;
}

/**
 * The generator's document written by another installation: its header and exact JSON formatting, every string only
 * `{file:…}`/`{env:…}` tokens with at least one reference into a private library, and all library references into one
 * single library that is not this installation's. Anything else (a literal string, own and foreign references mixed,
 * two foreign libraries, other formatting) is not recognised.
 */
export function isForeignProjectionText(config: ServerConfig, text: string): boolean {
  if (!text.startsWith(GENERATED_PROJECTION_HEADER)) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(GENERATED_PROJECTION_HEADER.length)); } catch { return false; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  if (`${GENERATED_PROJECTION_HEADER}${JSON.stringify(parsed, null, 2)}\n` !== text) return false;
  const own = join(runtimeStorageDir(config), LIBRARY);
  const values = strings(parsed, []);
  if (!values.length) return false;
  const libraries = new Set<string>();
  for (const value of values) {
    if (!TOKENS.test(value)) return false;
    let referenced = false;
    for (const match of value.matchAll(/\{file:([^}]+)\}/g)) {
      const path = match[1]!;
      if (!/[\\/]native-config-strings[\\/]/.test(path)) continue;
      const library = LIBRARY_FILE.exec(path);
      if (!library) return false;
      libraries.add(library[1]!);
      referenced = true;
    }
    if (!referenced) return false;
  }
  return libraries.size === 1 && !libraries.has(own);
}

/** Keeps the replaced foreign document privately (content-addressed), never in the client's shared folder. */
export async function archiveForeignProjection(config: ServerConfig, workspaceId: string, text: string): Promise<string> {
  const archive = join(runtimeStorageDir(config), "native-project-projection-archive", digest(workspaceId));
  await mkdir(archive, { recursive: true, mode: 0o700 });
  const path = join(archive, `${digest(text)}.foreign.jsonc`);
  try { await writeFile(path, text, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    if (await readFile(path, "utf8") !== text) throw new Error("The private project configuration archive was changed. The original file was preserved.");
  }
  return path;
}
