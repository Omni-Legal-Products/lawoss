/**
 * N-A5-8 (test 25. 10. 2026): po reštarte bez dostupnej siete ukázal Dnes len červené „Vaše prípady sa nepodarilo
 * načítať“ s technickým textom. Chyba, ktorá vyzerá ako problém spojenia (vypršaný čas, odmietnuté či prerušené
 * spojenie, certifikát, chyba servera 5xx), dostane obyčajnú vetu, čo skúsiť. Rozhoduje sa len z kódu, stavu a
 * známych typov chýb, text chyby sa advokátovi neukazuje.
 */
const NETWORK_NAMES = new Set(["AbortError", "TimeoutError"]);
const NETWORK_CODES = /^(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN|request_timeout|timeout)$/i;
const NETWORK_TEXT = /timed? ?out|časový limit|časový limit požadavku|fetch failed|failed to fetch|network ?error|certificate|ECONNREFUSED|ENOTFOUND/i;

export function isConnectionProblem(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name: unknown = Reflect.get(error, "name");
  const code: unknown = Reflect.get(error, "code");
  const status: unknown = Reflect.get(error, "status");
  const message: unknown = Reflect.get(error, "message");
  if (typeof name === "string" && NETWORK_NAMES.has(name)) return true;
  if (typeof code === "string" && NETWORK_CODES.test(code)) return true;
  if (typeof status === "number" && (status === 408 || status === 504 || (status >= 500 && status < 600))) return true;
  const cause: unknown = Reflect.get(error, "cause");
  if (cause && cause !== error && isConnectionProblem(cause)) return true;
  return typeof message === "string" && NETWORK_TEXT.test(message);
}
