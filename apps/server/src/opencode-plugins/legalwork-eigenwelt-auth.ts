/**
 * LegalWork Eigenwelt Auth Plugin
 *
 * Adds "Sign in with Eigenwelt" to the provider list. The flow keeps every
 * piece of Clerk configuration (client id, domains) OUT of the desktop app:
 *
 *   1. authorize() binds a loopback port from a fixed, pre-registered list,
 *      generates PKCE verifier+challenge and a random `state`, and opens the
 *      platform interstitial (https://platform.eigenwelt.ai/desktop/connect).
 *   2. The interstitial runs under the user's normal web session: sign-in if
 *      needed, firm (organization) picker, then redirect to Clerk's
 *      /oauth/authorize with our challenge and redirect_uri
 *      http://127.0.0.1:<port>/callback.
 *   3. The loopback catches the authorization code; the plugin forwards
 *      {state, code, verifier, port} to the platform's exchange endpoint,
 *      which performs the Clerk token exchange server-side, verifies the
 *      user + org binding, and mints a durable per-(user, org) virtual key.
 *   4. The callback returns {type:"success", key} so the engine stores the
 *      key as ordinary API-key auth — the OAuth artifacts are never persisted.
 *
 * The provider definition itself (baseURL, models) ships statically in the
 * LegalWork runtime config (see legalwork-runtime-config.ts).
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

const PLATFORM_URL = (process.env.EIGENWELT_PLATFORM_URL ?? "https://platform.eigenwelt.ai").replace(/\/+$/, "");

/** Pre-registered as exact redirect URIs on the Clerk OAuth application —
 * loopback ports cannot be random. Keep in sync with the platform. */
const LOOPBACK_PORTS = [43117, 43118, 43119] as const;

const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

const CALLBACK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Eigenwelt — connected</title>
<style>body{font-family:system-ui,sans-serif;background:#fefefe;color:#0e0a07;display:grid;place-items:center;min-height:90vh}main{text-align:center}h1{font-weight:500;letter-spacing:-0.04em}p{color:rgba(14,10,7,.55)}</style>
</head><body><main><h1>You're connected.</h1><p>Return to LegalWork — this tab can be closed.</p></main></body></html>`;

type Loopback = {
  port: number;
  /** Resolves with the authorization code once the browser redirects back. */
  code: Promise<string>;
  close: () => void;
};

async function listenOnFirstFreePort(expectedState: string): Promise<Loopback> {
  let resolveCode: (code: string) => void;
  let rejectCode: (err: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const tryPort = (port: number): Promise<Server | null> =>
    new Promise((resolve) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const receivedCode = url.searchParams.get("code");
        const receivedState = url.searchParams.get("state");
        if (!receivedCode || receivedState !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid callback.");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" }).end(CALLBACK_HTML);
        resolveCode(receivedCode);
      });
      server.once("error", () => resolve(null));
      server.listen(port, "127.0.0.1", () => resolve(server));
    });

  for (const port of LOOPBACK_PORTS) {
    const server = await tryPort(port);
    if (!server) continue;

    const timeout = setTimeout(() => {
      rejectCode(new Error("Sign-in timed out. Try again from the provider list."));
      server.close();
    }, AUTH_TIMEOUT_MS);

    return {
      port,
      code,
      close: () => {
        clearTimeout(timeout);
        server.close();
      },
    };
  }

  throw new Error(
    "Eigenwelt sign-in ports (43117-43119) are all in use. Close other LegalWork sign-in attempts and retry.",
  );
}

export const LegalworkEigenweltAuth = async () => ({
  auth: {
    provider: "eigenwelt",
    methods: [
      {
        label: "Sign in with Eigenwelt",
        type: "oauth" as const,
        authorize: async () => {
          const pkce = generatePkce();
          const state = base64url(randomBytes(24));
          const loopback = await listenOnFirstFreePort(state);

          const url = new URL(`${PLATFORM_URL}/desktop/connect`);
          url.searchParams.set("state", state);
          url.searchParams.set("port", String(loopback.port));
          url.searchParams.set("code_challenge", pkce.challenge);

          return {
            url: url.toString(),
            instructions: "Complete sign-in in your browser, pick your firm, and return here.",
            method: "auto" as const,
            callback: async () => {
              try {
                const code = await loopback.code;
                const response = await fetch(`${PLATFORM_URL}/api/desktop/exchange`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    state,
                    code,
                    verifier: pkce.verifier,
                    port: loopback.port,
                  }),
                });
                if (!response.ok) return { type: "failed" as const };
                const json = (await response.json()) as { apiKey?: string };
                if (!json.apiKey) return { type: "failed" as const };
                return { type: "success" as const, key: json.apiKey };
              } catch {
                return { type: "failed" as const };
              } finally {
                loopback.close();
              }
            },
          };
        },
      },
      {
        provider: "eigenwelt",
        label: "Paste an API key",
        type: "api" as const,
      },
    ],
  },
});
