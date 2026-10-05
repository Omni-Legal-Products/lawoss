import { t } from "@/i18n";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { parseFrontmatter } from "../../../../../lawoss/okf-pamat/src/record";
import { OFFICE_CONFIG_ENCODING_CODE, OFFICE_CONFIG_ENCODING_MESSAGE, parseOfficeWorkingProfile, workingProfile, type WorkingProfile } from "../../../../../lawoss/okf/src/profile";
import { stripBom } from "../../../../../lawoss/okf-pamat/src/text-decode";

type OfficeProfile = { profile: WorkingProfile; clientPath: string };
const editableKeys = new Set(["matter_folders", "folder_roles", "document_naming", "client_path"]);

function validateClientPath(value: string): string {
  if (value && !value.split("/").every((part) => part === "*" ||
    part !== "." && part !== ".." && /^[^*\\<>:"|?\u0000-\u001f]+$/.test(part) && part.trim() === part && !/[. ]$/.test(part))) {
    throw new Error(t("lawoss.setup.error.clientPath"));
  }
  return value;
}
export function readOfficeProfile(raw: string): OfficeProfile {
  // Server text dekóduje ako UTF-8 a BOM z Windows nechá; ten by skryl prvý kľúč pred kontrolou duplicít.
  const content = stripBom(raw);
  const fields = parseFrontmatter(content);
  const seen = new Set<string>();
  for (const line of content.split("\n")) {
    const key = /^([^\s#][^:]*):/.exec(line)?.[1];
    if (!key || !editableKeys.has(key.trim())) continue;
    if (key !== key.trim() || seen.has(key)) throw new Error(t("lawoss.setup.error.ambiguousProfile"));
    seen.add(key);
  }
  const path = fields.get("client_path") ?? "";
  if (typeof path !== "string") throw new Error(t("lawoss.setup.error.clientPathText"));
  return { profile: parseOfficeWorkingProfile(content) ?? workingProfile(), clientPath: validateClientPath(path) };
}

/**
 * okf.config v ANSI (PowerShell 5.1 `Set-Content`): server ho dekóduje ako UTF-8 a stratená diakritika je
 * U+FFFD. Prepis by ju natrvalo zapísal aj do cudzích riadkov (napr. meno v poverení), hoci Poznámkový blok
 * ešte vie súbor otvoriť správne; editor ho preto nezapíše.
 */
function assertNotDamaged(content: string): void {
  if (content.includes("\uFFFD")) {
    throw Object.assign(new Error(`${OFFICE_CONFIG_ENCODING_MESSAGE}: súbor obsahuje poškodený znak (U+FFFD)`), { code: OFFICE_CONFIG_ENCODING_CODE });
  }
}
export const isOfficeConfigEncodingError = (error: unknown) =>
  !!error && typeof error === "object" && "code" in error && error.code === OFFICE_CONFIG_ENCODING_CODE;

/** Replace only owned keys; keep unrelated settings (including authorization) byte-for-byte. */
export function updateOfficeProfile(raw: string, value: OfficeProfile): string {
  // Bez BOM, inak by prvý vlastnený kľúč ostal ako „cudzí“ riadok a zapísal sa dvakrát.
  const content = stripBom(raw);
  assertNotDamaged(content);
  readOfficeProfile(content);
  const profile = workingProfile(value.profile.folders, value.profile.roles, value.profile.naming);
  const clientPath = validateClientPath(value.clientPath);
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let skip = false;
  const kept = lines.filter((line) => {
    if (/^[^\s#]/.test(line)) skip = editableKeys.has(line.split(":", 1)[0]);
    return !skip || /^\s*(?:#|$)/.test(line);
  }).join("");
  const separator = kept && !kept.endsWith("\n") ? "\n" : "";
  const roleEntries = Object.entries(profile.roles);
  const roleBlock = roleEntries.length ? `\n${roleEntries.map(([role, folder]) => `  ${role}: ${JSON.stringify(folder)}`).join("\n")}` : " {}";
  const result = `${kept}${separator}matter_folders: ${JSON.stringify(profile.folders)}\nfolder_roles:${roleBlock}\ndocument_naming: ${JSON.stringify(profile.naming)}\nclient_path: ${JSON.stringify(clientPath)}\n`;
  readOfficeProfile(result);
  return result;
}

export type OfficeProfileSnapshot = { path: string; content: string | null; value: OfficeProfile };
type ProfileClient = Pick<LegalworkServerClient, "statWorkspaceFile" | "readWorkspaceFile" | "writeWorkspaceFile">;
export async function loadOfficeProfile(client: ProfileClient, workspaceId: string, workspacePath: string): Promise<OfficeProfileSnapshot> {
  const basename = workspacePath.replaceAll("\\", "/").replace(/\/$/, "").split("/").pop();
  let path = "okf.config";
  if (basename !== "Office" && basename !== "_kancelaria") {
    const paths = ["Office", "_kancelaria", "client.md", "klient.md", "matter.md", "spis.md", "project.md", "projekt.md"];
    const stats = await Promise.all(paths.map((name) => client.statWorkspaceFile(workspaceId, name)));
    if (stats.slice(2).some((item) => item.exists)) throw new Error(t("lawoss.setup.error.officeRoot"));
    if (stats[0].exists && stats[1].exists) throw new Error(t("lawoss.setup.error.twoOffices"));
    const index = stats[1].exists ? 1 : 0;
    if (stats[index].exists && stats[index].kind !== "dir") throw new Error(t("lawoss.setup.error.officeNotFolder"));
    path = `${paths[index]}/okf.config`;
  }
  const state = await client.statWorkspaceFile(workspaceId, path);
  if (state.exists && state.kind !== "file") throw new Error(t("lawoss.setup.error.configNotFile"));
  const content = state.exists ? (await client.readWorkspaceFile(workspaceId, path)).content : null;
  if (content !== null) assertNotDamaged(content);
  return { path, content, value: readOfficeProfile(content ?? "") };
}
export async function saveOfficeProfile(client: ProfileClient, workspaceId: string, snapshot: OfficeProfileSnapshot, value: OfficeProfile): Promise<OfficeProfileSnapshot> {
  const content = updateOfficeProfile(snapshot.content ?? "", value);
  await client.writeWorkspaceFile(workspaceId, { path: snapshot.path, content, expectedContent: snapshot.content });
  return { path: snapshot.path, content, value: readOfficeProfile(content) };
}
