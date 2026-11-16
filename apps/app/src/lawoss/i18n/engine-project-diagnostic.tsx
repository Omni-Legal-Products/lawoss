/**
 * LAWOSS #509: the server reports problems with a client's generated OpenCode settings
 * (`apps/server/src/engine-project.ts`) only as fixed English sentences without a code. Each known sentence is shown
 * in the user's language at render time; the original stays under "technical details". An unknown sentence is shown
 * unchanged. The test `tests/lawoss-engine-project-diagnostic-509.test.ts` checks every sentence against the server.
 */
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { Language } from "@/i18n";

export const ENGINE_PROJECT_DIAGNOSTIC_KEYS = {
  "This project folder is unavailable. Reconnect its existing folder before starting OpenCode automation.":
    "lawoss.diagnostics.project_folder_unavailable",
  "LegalWork cannot access or update this project's settings. Reconnect the project folder and allow access to its .opencode folder, then refresh. Other projects remain available.":
    "lawoss.diagnostics.project_access_denied",
  "Both native OpenCode files inside .opencode are already authored. Preserve them and reserve .opencode/opencode.json or .opencode/opencode.jsonc for LegalWork's generated project settings.":
    "lawoss.diagnostics.project_files_authored",
  "The LegalWork-generated OpenCode file was changed outside LegalWork. Preserve your edits by moving them into another native OpenCode config file, then remove this generated file and retry.":
    "lawoss.diagnostics.project_projection_edited",
  "LegalWork generated the OpenCode settings file in .opencode, but its private receipt is missing (app data was reset, or the folder was opened on another computer). LegalWork takes it over when it next publishes settings, if the file still matches them. If you edited it, move your edits into another native OpenCode config file, remove .opencode/opencode.json and retry.":
    "lawoss.diagnostics.project_projection_unreceipted",
  "Another LegalWork installation (another computer or user profile) that opened this folder replaced the OpenCode settings file in .opencode with its own generated file. LegalWork takes it over when it next publishes settings (restart or Refresh), if its structure matches these settings. If it does not match, or you edited it, move your edits into another native OpenCode config file, remove .opencode/opencode.json and retry.":
    "lawoss.diagnostics.project_projection_foreign",
} as const;

const keys = new Map<string, string>(Object.entries(ENGINE_PROJECT_DIAGNOSTIC_KEYS));

export function engineProjectDiagnosticText(diagnostic: string, locale: Language): string {
  const key = keys.get(diagnostic);
  return key ? t(key, locale) : diagnostic;
}

export function EngineProjectDiagnostic({ diagnostic }: { diagnostic: string }) {
  const locale = useLocale();
  const text = engineProjectDiagnosticText(diagnostic, locale);
  return <>
    <p>{text}</p>
    {text !== diagnostic ? <details className="mt-1 text-muted-foreground"><summary>{t("lawoss.diagnostics.details", locale)}</summary><pre className="whitespace-pre-wrap break-words">{diagnostic}</pre></details> : null}
  </>;
}
