/**
 * N-A5-8 (test 25. 10. 2026): po reštarte bez dostupnej siete ukázal Dnes len červené „Vaše prípady sa nepodarilo
 * načítať“ s technickým textom. Chyba, ktorá vyzerá ako problém spojenia (vypršaný čas, odmietnuté či prerušené
 * spojenie, certifikát, nedostupná brána), dostane obyčajnú vetu, čo skúsiť. Rozhoduje sa len z kódu, stavu a
 * známych typov chýb, text chyby sa advokátovi neukazuje.
 */
const NETWORK_NAMES = new Set(["AbortError", "TimeoutError"]);
const NETWORK_CODES = /^(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN|request_timeout|timeout)$/i;
const NETWORK_TEXT = /timed? ?out|časový limit|zeitüberschreitung|fetch failed|failed to fetch|network ?error|certificate|ECONNREFUSED|ENOTFOUND/i;
/** Brána a dočasná nedostupnosť, nie chyba v samotnom čítaní prípadov (500 môže byť aj chyba appky). */
const NETWORK_STATUSES = new Set([408, 502, 503, 504]);

export function isConnectionProblem(error: unknown): boolean {
  // Chyba spojenia appky (`useOkfConnection`) a rozsahu prichádza ako text (napr. „Vypršal časový limit požiadavky.“).
  if (typeof error === "string") return NETWORK_TEXT.test(error);
  if (!error || typeof error !== "object") return false;
  const name: unknown = Reflect.get(error, "name");
  const code: unknown = Reflect.get(error, "code");
  const status: unknown = Reflect.get(error, "status");
  const message: unknown = Reflect.get(error, "message");
  if (typeof name === "string" && NETWORK_NAMES.has(name)) return true;
  if (typeof code === "string" && NETWORK_CODES.test(code)) return true;
  if (typeof status === "number" && NETWORK_STATUSES.has(status)) return true;
  const cause: unknown = Reflect.get(error, "cause");
  if (cause && cause !== error && isConnectionProblem(cause)) return true;
  return typeof message === "string" && NETWORK_TEXT.test(message);
}
