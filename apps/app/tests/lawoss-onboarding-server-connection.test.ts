import { describe, expect, test } from "bun:test";
import { watchLegalworkConnection, type LegalworkConnectionLike } from "../src/lawoss/domains/onboarding/server-connection";

const ready: LegalworkConnectionLike = { normalizedBaseUrl: "http://127.0.0.1:1", resolvedToken: "t", resolvedHostToken: "" };
const empty: LegalworkConnectionLike = { normalizedBaseUrl: "", resolvedToken: "", resolvedHostToken: "" };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function harness(results: LegalworkConnectionLike[], timeoutMs = 1_000) {
  const target = new EventTarget();
  const seen: { ready: LegalworkConnectionLike[]; unavailable: string[] } = { ready: [], unavailable: [] };
  let calls = 0;
  const stop = watchLegalworkConnection({
    resolve: async () => results[Math.min(calls++, results.length - 1)]!,
    onReady: connection => seen.ready.push(connection),
    onUnavailable: message => seen.unavailable.push(message),
    target,
    timeoutMs,
  });
  return { target, seen, stop, calls: () => calls };
}

describe("pripojenie onboardingu k serveru LAWOSS", () => {
  test("hneď dostupný server sa použije bez čakania", async () => {
    const { seen, stop } = harness([ready]);
    await flush();
    expect(seen.ready).toEqual([ready]);
    expect(seen.unavailable).toEqual([]);
    stop();
  });

  test("pri prvom štarte počká na udalosť servera namiesto chyby", async () => {
    const { target, seen, stop, calls } = harness([empty, ready]);
    await flush();
    expect(seen.ready).toEqual([]);
    expect(seen.unavailable).toEqual([]);
    target.dispatchEvent(new Event("legalwork-server-settings-changed"));
    await flush();
    expect(calls()).toBe(2);
    expect(seen.ready).toEqual([ready]);
    stop();
  });

  test("chybu ukáže až po uplynutí čakania", async () => {
    const { seen, stop } = harness([empty], 5);
    await flush();
    expect(seen.unavailable).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(seen.unavailable).toEqual(["LAWOSS server is unavailable"]);
    stop();
  });

  test("po pripojení ani po zastavení už nereaguje", async () => {
    const { target, seen, stop, calls } = harness([ready], 5);
    await flush();
    target.dispatchEvent(new Event("legalwork-server-settings-changed"));
    await flush();
    expect(calls()).toBe(1);
    stop();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(seen.ready).toEqual([ready]);
    expect(seen.unavailable).toEqual([]);
  });
});
