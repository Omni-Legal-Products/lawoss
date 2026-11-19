import { ApiError } from "../errors.js";

/** #565: transport failure codes of the target (Node, Bun and Undici), mapped to the reason the agent reads. */
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const UNREACHABLE_REASONS: Readonly<Record<string, string>> = {
  ECONNREFUSED: "the connection was refused",
  ECONNRESET: "the connection was reset",
  ECONNABORTED: "the connection was aborted",
  EPIPE: "the connection was closed",
  EHOSTUNREACH: "the host is unreachable",
  EHOSTDOWN: "the host is down",
  ENETUNREACH: "the network is unreachable",
  ENETDOWN: "the network is down",
  EADDRNOTAVAIL: "the address is not available",
  ENOTFOUND: "the domain name does not exist",
  EAI_NONAME: "the domain name does not exist",
  EAI_NODATA: "the domain name has no address",
  ENODATA: "the domain name has no address",
  EAI_AGAIN: "the domain name could not be resolved right now",
  EAI_FAIL: "the domain name could not be resolved",
  ESERVFAIL: "the domain name could not be resolved",
  UND_ERR_SOCKET: "the connection was closed",
  UND_ERR_CLOSED: "the connection was closed",
};
const TLS_PREFIXES = ["ERR_SSL_", "ERR_TLS_", "CERT_", "UNABLE_TO_", "DEPTH_ZERO_", "SELF_SIGNED_", "HOSTNAME_MISMATCH"];

function errorCodes(error: unknown): string[] {
  const codes: string[] = [], queue = [error], seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (!(current instanceof Error) || seen.has(current)) continue;
    seen.add(current);
    if ("code" in current && typeof current.code === "string") codes.push(current.code);
    queue.push(current.cause);
    if (current instanceof AggregateError) queue.push(...current.errors);
  }
  return codes;
}

export function sandboxHttpTimeout(host: string): ApiError {
  return new ApiError(504, "sandbox_http_timeout", `HTTP request timed out: ${host} did not respond within 30 seconds. The site may be down or blocked from this network.`);
}

/** Network failure of the target as a typed error; anything else (policy, validation, cancellation) stays as it was. */
export function sandboxHttpFailure(error: unknown, host: string): ApiError | undefined {
  if (error instanceof ApiError) return undefined;
  for (const code of errorCodes(error)) {
    if (TIMEOUT_CODES.has(code)) return sandboxHttpTimeout(host);
    const reason = UNREACHABLE_REASONS[code]
      ?? (TLS_PREFIXES.some(prefix => code.startsWith(prefix)) ? "its TLS certificate or connection could not be verified" : undefined);
    if (reason) return new ApiError(502, "sandbox_http_unreachable", `Could not reach ${host}: ${reason} (${code}).`, { reason: code });
  }
  return undefined;
}
