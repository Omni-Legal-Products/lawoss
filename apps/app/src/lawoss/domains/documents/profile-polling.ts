import { LegalworkServerError } from "@/app/lib/legalwork-server";

/**
 * #563: odpoveď „vybraný model nie je podporovaný OpenAI-compatible poskytovateľ“ sa nezmení, kým advokát nezvolí iný
 * model (ten je v kľúči dotazu). Panel ju preto neopakuje každých 5 s ani pri zlyhaní; ostatné chyby ako doteraz.
 */
const PERMANENT_PROFILE_ERRORS = new Set(["protected_ai_provider_unsupported"]);
const PROFILE_REFRESH_MS = 5000;

const isPermanentProfileError = (error: unknown): boolean =>
  error instanceof LegalworkServerError && PERMANENT_PROFILE_ERRORS.has(error.code);

export const profilesRefetchInterval = (active: boolean, error: unknown): number | false =>
  active && !isPermanentProfileError(error) ? PROFILE_REFRESH_MS : false;

export const profilesRetry = (failureCount: number, error: unknown): boolean =>
  !isPermanentProfileError(error) && failureCount < 3;
