import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_UPDATE_STATE,
  WEEKLY_CHECK_INTERVAL_MS,
  checkMarketplaceRelease,
  highestVersionTag,
  isWeeklyCheckDue,
  marketplaceApiUrl,
  marketplaceRawUrl,
  readUpdateState,
  runMarketplaceCheck,
  updateUpdateState,
  weeklyTick,
} from "./marketplace-updates.js";

const SHA = "a".repeat(40);
const DAY = 24 * 60 * 60 * 1000;

/** Vymyslené odpovede GitHubu; zaznamenáva každú adresu, na ktorú kontrola siahla. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    const handler = routes[url];
    return handler ? handler() : new Response("{}", { status: 404 });
  };
  return { calls, fetchImpl };
}

const manifest = () => new Response(JSON.stringify({ plugins: [
  { name: "slovlex", version: "1.2.0", source: "./plugins/slovlex" },
  { name: "zly", version: "1.0.0", source: "../mimo" },
] }));

describe("LAWOSS Marketplace: kontrola vydaní", () => {
  // Iné testy v tom istom behu nastavujú lokálny GitHub; tu platia predvolené adresy.
  const keys = ["LEGALWORK_GITHUB_API_BASE", "LEGALWORK_GITHUB_RAW_BASE"] as const;
  let saved: Array<string | undefined> = [];
  beforeEach(() => { saved = keys.map((key) => process.env[key]); keys.forEach((key) => delete process.env[key]); });
  afterEach(() => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }));

  test("zdroj je len repozitár lawoss-marketplace na api.github.com a jeho raw obsah", () => {
    expect(marketplaceApiUrl("releases/latest")).toBe("https://api.github.com/repos/Omni-Legal-Products/lawoss-marketplace/releases/latest");
    expect(marketplaceRawUrl(SHA, ".claude-plugin/marketplace.json")).toBe(`https://raw.githubusercontent.com/Omni-Legal-Products/lawoss-marketplace/${SHA}/.claude-plugin/marketplace.json`);
    expect(WEEKLY_CHECK_INTERVAL_MS).toBe(7 * DAY);
  });

  test("posledné vydanie: tag, SHA a verzie pluginov; neplatné cesty sa vynechajú", async () => {
    const { calls, fetchImpl } = fakeFetch({
      [marketplaceApiUrl("releases/latest")]: () => Response.json({ tag_name: "v0.2.0", published_at: "2026-10-12T08:00:00Z" }),
      [marketplaceApiUrl("commits/v0.2.0")]: () => Response.json({ sha: SHA }),
      [marketplaceRawUrl(SHA, ".claude-plugin/marketplace.json")]: manifest,
    });
    expect(await checkMarketplaceRelease(fetchImpl)).toEqual({
      status: "ok",
      release: { tag: "v0.2.0", sha: SHA, publishedAt: "2026-10-12T08:00:00Z", source: "release", plugins: [{ name: "slovlex", version: "1.2.0", path: "plugins/slovlex" }] },
    });
    expect(calls.every((url) => url.startsWith("https://api.github.com/repos/Omni-Legal-Products/lawoss-marketplace/") || url.startsWith("https://raw.githubusercontent.com/Omni-Legal-Products/lawoss-marketplace/"))).toBe(true);
  });

  test("bez vydania sa použije najvyšší tag vX.Y.Z; bez tagov stav no_release", async () => {
    expect(highestVersionTag(["v0.1.0", "v0.10.0", "v0.9.3", "pokus", "v1.0"])).toBe("v0.10.0");
    const tagged = fakeFetch({
      [marketplaceApiUrl("tags?per_page=100")]: () => Response.json([{ name: "v0.1.0" }, { name: "v0.2.0" }]),
      [marketplaceApiUrl("commits/v0.2.0")]: () => Response.json({ sha: SHA }),
      [marketplaceRawUrl(SHA, ".claude-plugin/marketplace.json")]: manifest,
    });
    expect(await checkMarketplaceRelease(tagged.fetchImpl)).toMatchObject({ status: "ok", release: { tag: "v0.2.0", source: "tag" } });
    const empty = fakeFetch({ [marketplaceApiUrl("tags?per_page=100")]: () => Response.json([]) });
    expect(await checkMarketplaceRelease(empty.fetchImpl)).toEqual({ status: "no_release" });
  });

  test("chyba siete sa uloží ako stav, nevyhodí", async () => {
    const failing = async () => { throw new Error("offline"); };
    expect(await checkMarketplaceRelease(failing)).toEqual({ status: "error", message: "offline" });
  });
});

describe("LAWOSS Marketplace: týždenná kontrola", () => {
  let root = "";
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "lawoss-weekly-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  test("isWeeklyCheckDue: vypnutá nikdy, inak až po týždni od poslednej kontroly alebo začiatku", () => {
    const now = 1_000 * DAY;
    expect(isWeeklyCheckDue(DEFAULT_UPDATE_STATE, now)).toBe(false);
    expect(isWeeklyCheckDue({ ...DEFAULT_UPDATE_STATE, anchorAt: now - 6 * DAY }, now)).toBe(false);
    expect(isWeeklyCheckDue({ ...DEFAULT_UPDATE_STATE, anchorAt: now - 7 * DAY }, now)).toBe(true);
    expect(isWeeklyCheckDue({ ...DEFAULT_UPDATE_STATE, anchorAt: now - 30 * DAY, lastCheckedAt: now - DAY }, now)).toBe(false);
    expect(isWeeklyCheckDue({ ...DEFAULT_UPDATE_STATE, weeklyCheck: false, anchorAt: now - 30 * DAY }, now)).toBe(false);
  });

  test("prvé spustenie len zapíše začiatok týždňa bez siete; kontrola až po týždni", async () => {
    const path = join(root, "lawoss-marketplace.json");
    let now = 100 * DAY;
    const { calls, fetchImpl } = fakeFetch({ [marketplaceApiUrl("tags?per_page=100")]: () => Response.json([]) });
    expect(await weeklyTick(path, { now: () => now, fetchImpl })).toBe("anchored");
    now += 6 * DAY;
    expect(await weeklyTick(path, { now: () => now, fetchImpl })).toBe("idle");
    expect(calls).toEqual([]);
    now += DAY;
    expect(await weeklyTick(path, { now: () => now, fetchImpl })).toBe("checked");
    expect((await readUpdateState(path)).lastCheckedAt).toBe(now);
    expect(calls.length).toBeGreaterThan(0);
    await updateUpdateState(path, (state) => ({ ...state, weeklyCheck: false }));
    now += 30 * DAY;
    expect(await weeklyTick(path, { now: () => now, fetchImpl })).toBe("idle");
  });

  test("otvorenie Marketplace krátko po kontrole použije uložený výsledok; tlačidlo kontroluje vždy", async () => {
    const path = join(root, "lawoss-marketplace.json");
    const { calls, fetchImpl } = fakeFetch({ [marketplaceApiUrl("tags?per_page=100")]: () => Response.json([]) });
    let now = 10 * DAY;
    await runMarketplaceCheck(path, "manual", { now: () => now, fetchImpl });
    const first = calls.length;
    now += 60_000;
    await runMarketplaceCheck(path, "open", { now: () => now, fetchImpl });
    expect(calls.length).toBe(first);
    await runMarketplaceCheck(path, "manual", { now: () => now, fetchImpl });
    expect(calls.length).toBeGreaterThan(first);
  });
});
