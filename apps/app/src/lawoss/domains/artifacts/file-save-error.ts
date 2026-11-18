import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

const MESSAGES: ReadonlyMap<string, string> = new Map([
  ["file_not_writable", "lawoss.file_save.not_writable"],
  ["disk_full", "lawoss.file_save.disk_full"],
]);

/** #545: a save the lawyer must resolve (no write permission, full disk) gets a translated message; other errors keep theirs. */
export function fileSaveErrorMessage(error: unknown): string | null {
  const key = error instanceof LegalworkServerError ? MESSAGES.get(error.code) : undefined;
  return key === undefined ? null : t(key);
}

/** The same server error with the translated message, so every save surface (toast, autosave banner) shows it. */
export function localizedFileSaveError(error: unknown): unknown {
  const message = fileSaveErrorMessage(error);
  return message !== null && error instanceof LegalworkServerError ? new LegalworkServerError(error.status, error.code, message, error.details) : error;
}
