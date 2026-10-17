// Read-only operator check for an existing Gmail connection; never saves provider tokens.
// Usage: pnpm --filter legalwork-server exec bun scripts/nango-gmail-smoke.ts <private-credential-key-file> <private-connection-file> [report-file]
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { gmailAdapter } from "../src/connectors/mail.js";

const keyFile = process.argv[2];
if (!keyFile) throw new Error("Provide the path to a private Nango API key file.");
const key = (await readFile(keyFile, "utf8")).trim();
const connectionFile = process.argv[3];
if (!connectionFile) throw new Error("Provide a private JSON file containing the known connectionId and integrationId.");
const connection = z.object({ connectionId: z.string().min(1), integrationId: z.string().min(1) }).parse(JSON.parse(await readFile(connectionFile, "utf8")));
const checks: { host: string; operation: string; status: number }[] = [];
async function nango(path: string) {
  const response = await fetch(`https://api.nango.dev${path}`, { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  checks.push({ host: "api.nango.dev", operation: "retrieve-known-credentials", status: response.status });
  if (!response.ok) throw new Error(`Nango authentication check failed: HTTP ${response.status}`);
  return response.json();
}
for (const forceRefresh of [false, true]) {
  const query = new URLSearchParams({ provider_config_key: connection.integrationId, force_refresh: String(forceRefresh), refresh_token: "false" });
  const credentials = z.object({ credentials: z.object({ access_token: z.string().min(1) }) }).parse(await nango(`/connections/${encodeURIComponent(connection.connectionId)}?${query}`)).credentials;
  if (/redacted|\.\.\./i.test(credentials.access_token)) throw new Error("Nango did not return a usable access token.");
  await gmailAdapter.test(async (path) => {
    if (path !== "/gmail/v1/users/me/profile?fields=emailAddress") throw new Error("Unexpected smoke-test endpoint.");
    const response = await fetch(`https://gmail.googleapis.com${path}`, { headers: { Authorization: `Bearer ${credentials.access_token}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
    checks.push({ host: "gmail.googleapis.com", operation: forceRefresh ? "direct-profile-after-refresh" : "direct-profile", status: response.status });
    if (!response.ok) throw new Error(`Direct Gmail check failed: HTTP ${response.status}`);
    return response.json();
  });
}
const report = { checkedAt: new Date().toISOString(), ok: true, provider: "gmail", adapter: "LegalWork gmailAdapter", checks };
if (process.argv[4]) await writeFile(process.argv[4], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
