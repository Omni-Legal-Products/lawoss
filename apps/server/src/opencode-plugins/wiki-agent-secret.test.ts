import { afterEach, beforeEach, expect, test } from "bun:test";
import { ENGINE_CONNECTION_REFUSED, WIKI_AGENT_TICKET_ENV, WIKI_AGENT_TICKET_PATH } from "../lawoss/engine-agent-contract.js";
import { listWorkspaces, serverConnected, workspaceToolHeaders } from "./office-plugin-shared.js";
import { acquireWikiAgentSecret, adoptWikiAgentSecret, wikiAgentSecret, wikiAgentSecretFailed } from "./wiki-agent-secret.js";

const prior = process.env.LEGALWORK_SERVER_URL;
beforeEach(() => adoptWikiAgentSecret(""));
afterEach(() => {
  adoptWikiAgentSecret("");
  if (prior === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = prior;
});
const TICKET = "synthetic-ticket-value";
const base = "http://127.0.0.1:1";
const engineEnv = (): Record<string, string | undefined> => ({ [WIKI_AGENT_TICKET_ENV]: TICKET, LEGALWORK_SERVER_URL: base });
const responding = (respond: () => Response) => {
  const calls: Array<{ url: string; body: string }> = [];
  const send = Object.assign(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return respond();
  }, { preconnect: fetch.preconnect });
  return { calls, send };
};
const context = { sessionID: "ses_a", directory: "/prax/A" };

test("the ticket leaves the environment before the request, and concurrent plugins share one redemption", async () => {
  const env = engineEnv();
  const { calls, send } = responding(() => Response.json({ secret: "synthetic-secret" }));
  const first = acquireWikiAgentSecret(env, send);
  expect(env[WIKI_AGENT_TICKET_ENV]).toBeUndefined();
  const second = acquireWikiAgentSecret(env, send);
  expect(wikiAgentSecret()).toBe("");
  await Promise.all([first, second]);
  expect(calls).toEqual([{ url: `${base}${WIKI_AGENT_TICKET_PATH}`, body: JSON.stringify({ ticket: TICKET }) }]);
  expect(wikiAgentSecret()).toBe("synthetic-secret");
});

test("separately loaded copies of the module share the secret", async () => {
  adoptWikiAgentSecret("synthetic-secret");
  const specifier = "./wiki-agent-secret.ts?bundle=second";
  // A query string gives a second module instance, which the type system cannot name.
  const copy = await import(specifier) as typeof import("./wiki-agent-secret.js");
  expect(copy.wikiAgentSecret()).toBe("synthetic-secret");
  expect(copy.acquireWikiAgentSecret).not.toBe(acquireWikiAgentSecret);
  copy.adoptWikiAgentSecret("replaced");
  expect(wikiAgentSecret()).toBe("replaced");
});

test("a later instance's plugin with nothing in the environment keeps the secret", async () => {
  adoptWikiAgentSecret("synthetic-secret");
  const { calls, send } = responding(() => new Response(null, { status: 500 }));
  await acquireWikiAgentSecret({ LEGALWORK_SERVER_URL: base }, send);
  expect(calls).toEqual([]);
  expect(wikiAgentSecret()).toBe("synthetic-secret");
  expect(wikiAgentSecretFailed()).toBe(false);
});

test("a refused ticket fails closed with the lawyer's message, once, and leaks nothing", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    const { calls, send } = responding(() => Response.json({ code: "wiki_agent_ticket_refused", message: ENGINE_CONNECTION_REFUSED }, { status: 403 }));
    await acquireWikiAgentSecret(engineEnv(), send);
    expect(calls).toHaveLength(1);
  } finally { console.error = original; }
  expect(wikiAgentSecret()).toBe("");
  expect(wikiAgentSecretFailed()).toBe(true);
  process.env.LEGALWORK_SERVER_URL = base;
  expect(serverConnected(context)).toBe(true);
  await expect(workspaceToolHeaders(context)).rejects.toThrow(ENGINE_CONNECTION_REFUSED);
  await expect(listWorkspaces(context)).rejects.toThrow(ENGINE_CONNECTION_REFUSED);
  expect(errors.join("\n")).not.toContain(TICKET);
  expect(ENGINE_CONNECTION_REFUSED).toContain("Nothing was read or changed.");
  expect(ENGINE_CONNECTION_REFUSED).toContain("quit LAWOSS completely");
  expect(ENGINE_CONNECTION_REFUSED).not.toMatch(/ticket|token|secret|403|runtime|LegalWork/i);
});

test("a server that cannot answer yet is retried a few times, then fails closed; a malformed answer fails closed at once", async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    let attempts = 0;
    const flaky = Object.assign(async () => {
      if (++attempts === 1) throw new TypeError("connection refused");
      if (attempts === 2) return new Response(null, { status: 503 });
      return Response.json({ secret: "synthetic-secret" });
    }, { preconnect: fetch.preconnect });
    await acquireWikiAgentSecret(engineEnv(), flaky);
    expect({ attempts, secret: wikiAgentSecret(), failed: wikiAgentSecretFailed() }).toEqual({ attempts: 3, secret: "synthetic-secret", failed: false });
    adoptWikiAgentSecret("");
    const down = Object.assign(async () => { throw new TypeError("connection refused"); }, { preconnect: fetch.preconnect });
    await acquireWikiAgentSecret(engineEnv(), down);
    expect(wikiAgentSecretFailed()).toBe(true);
    adoptWikiAgentSecret("");
    const malformed = responding(() => Response.json({ secret: 7 }));
    await acquireWikiAgentSecret(engineEnv(), malformed.send);
    expect(wikiAgentSecretFailed()).toBe(true);
    expect(malformed.calls).toHaveLength(1);
    adoptWikiAgentSecret("");
    await acquireWikiAgentSecret(engineEnv(), responding(() => new Response("<html>", { status: 200 })).send);
    expect(wikiAgentSecretFailed()).toBe(true);
  } finally { console.error = original; }
});

test("without a ticket nothing is redeemed and a plugin simply has no connection", async () => {
  await acquireWikiAgentSecret({ LEGALWORK_SERVER_URL: base }, responding(() => Response.json({ secret: "x" })).send);
  process.env.LEGALWORK_SERVER_URL = base;
  expect(wikiAgentSecret()).toBe("");
  expect(serverConnected(context)).toBe(false);
  expect(await workspaceToolHeaders(context)).toEqual({});
});
