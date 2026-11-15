// LAWOSS #418: po zatvorení Nastavení sa trasa chatu pripojí nanovo. Pri tom istom spojení začne posledným zoznamom
// klientov (bez „Príprava pracovného priestoru“), pri inom spojení prázdna; prehľad OKF sa pri zmene nastavení nemaže.
import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { revalidateOkfOverview } from "../src/lawoss/okf/read-model";
import {
  initialWorkspaceRouteState, noteResolvedConnection, rememberWorkspaceRoute, storedSettingsKey, withoutRemountRetrying, workspaceConnectionKey,
  workspaceRouteForRemount,
} from "../src/lawoss/shell/route-snapshot";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const workspace = (id: string): RouteWorkspace => ({ id, name: id, displayNameResolved: id, path: `/synthetic/${id}`, preset: "starter", workspaceType: "local" });
const settings = { urlOverride: "http://127.0.0.1:4100", token: "synthetic-token", hostToken: "synthetic-host" };
const client = createLegalworkServerClient({ baseUrl: settings.urlOverride, token: settings.token, hostToken: settings.hostToken });
const keep = (workspaces: RouteWorkspace[], stored = settings) => rememberWorkspaceRoute({
  settingsKey: storedSettingsKey(stored), connectionKey: workspaceConnectionKey(settings.urlOverride, settings.token, settings.hostToken),
  client, baseUrl: settings.urlOverride, token: settings.token, hostToken: settings.hostToken, workspaces,
});

afterEach(() => rememberWorkspaceRoute(null));

describe("#418: počiatočný stav trasy po opätovnom pripojení", () => {
  test("prvé pripojenie bez uloženého zoznamu: prázdne a načítava sa", () => {
    expect(initialWorkspaceRouteState(workspaceRouteForRemount(storedSettingsKey(settings), ""))).toEqual({
      loading: true, hasLoadedServerWorkspaces: false, workspaces: [], client: null, baseUrl: "", token: "", hostToken: "", retryingWorkspaceIds: [], connection: null });
  });

  test("to isté spojenie: posledný zoznam klientov, spojenie a žiadne načítavanie", () => {
    const list = [workspace("K1-Tatran"), workspace("K3-Hron")];
    keep(list);
    const state = initialWorkspaceRouteState(workspaceRouteForRemount(storedSettingsKey({ ...settings }), ""));
    expect(state.loading).toBe(false);
    expect(state.hasLoadedServerWorkspaces).toBe(true);
    expect(state.workspaces.map((item) => item.id)).toEqual(["K1-Tatran", "K3-Hron"]);
    expect(state.client).toBe(client);
    // Chats load again in the background: the clients show as loading, an open chat is not "not found" meanwhile.
    expect(state.retryingWorkspaceIds).toEqual(["K1-Tatran", "K3-Hron"]);
    expect(state).toMatchObject({ baseUrl: settings.urlOverride, token: settings.token, hostToken: settings.hostToken,
      connection: { key: workspaceConnectionKey(settings.urlOverride, settings.token, settings.hostToken), client } });
    // An address with a known client keeps the list too.
    expect(workspaceRouteForRemount(storedSettingsKey(settings), "K3-Hron")?.workspaces).toHaveLength(2);
  });

  test("iné spojenie alebo profil: prázdne, žiadny zoznam iného servera", () => {
    keep([workspace("K1-Tatran")]);
    for (const other of [
      { ...settings, urlOverride: "http://127.0.0.1:4200" },
      { ...settings, token: "rotated-token" },
      { ...settings, hostToken: "" },
      { ...settings, portOverride: 4300 },
      {},
    ]) {
      const state = initialWorkspaceRouteState(workspaceRouteForRemount(storedSettingsKey(other), ""));
      expect(state).toMatchObject({ loading: true, hasLoadedServerWorkspaces: false, workspaces: [], client: null, retryingWorkspaceIds: [], connection: null });
    }
  });

  test("adresa s klientom, ktorého zoznam nepozná (napr. nový), a odpojený server: prázdne", () => {
    keep([workspace("K1-Tatran")]);
    expect(workspaceRouteForRemount(storedSettingsKey(settings), "K9-Novy")).toBeNull();
    rememberWorkspaceRoute(null);
    expect(workspaceRouteForRemount(storedSettingsKey(settings), "")).toBeNull();
  });
});

describe("#418: zlyhané obnovenie a zmena spojenia", () => {
  test("po chybe obnovenia klienti zo zoznamu nezostanú načítavať; iné načítavanie ostane", () => {
    keep([workspace("K1-Tatran"), workspace("K3-Hron")]);
    const seeded = initialWorkspaceRouteState(workspaceRouteForRemount(storedSettingsKey(settings), "")).retryingWorkspaceIds;
    expect(withoutRemountRetrying(seeded, seeded)).toEqual([]);
    expect(withoutRemountRetrying([...seeded, "K5-Iny"], seeded)).toEqual(["K5-Iny"]);
    expect(withoutRemountRetrying(["K1-Tatran"], [])).toEqual(["K1-Tatran"]);
  });

  test("predvolené desktopové spojenie (rovnaké uložené nastavenia): iné zistené spojenie zabudne zoznam pred pripojením", () => {
    const desktop = {};
    keep([workspace("K1-Tatran")], desktop);
    noteResolvedConnection(settings.urlOverride, settings.token, settings.hostToken);
    expect(workspaceRouteForRemount(storedSettingsKey(desktop), "")?.workspaces).toHaveLength(1);
    noteResolvedConnection("http://127.0.0.1:4999", "new-boot-token", "new-host");
    expect(workspaceRouteForRemount(storedSettingsKey(desktop), "")).toBeNull();
    keep([workspace("K1-Tatran")], desktop);
    noteResolvedConnection("", "", "");
    expect(workspaceRouteForRemount(storedSettingsKey(desktop), "")).toBeNull();
  });
});

describe("#418: prehľad OKF pri zmene nastavení", () => {
  test("posledný prehľad ostáva v cache a označí sa na nové čítanie", () => {
    const queries = new QueryClient();
    const key = ["okf-overview", "scope", settings.urlOverride, settings.token, 0, "2026-11-15"];
    queries.setQueryData(key, { coverage: { sources: [] } });
    queries.setQueryData(["okf-practice-root", "x"], "/synthetic");
    revalidateOkfOverview(queries);
    expect(queries.getQueryData(key)).toEqual({ coverage: { sources: [] } });
    expect(queries.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queries.getQueryState(["okf-practice-root", "x"])?.isInvalidated).toBe(true);
    queries.clear();
  });
});
