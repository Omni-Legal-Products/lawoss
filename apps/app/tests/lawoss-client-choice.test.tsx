import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { clientRootOf, defaultClientChoice, newMatterLink, practiceClientChoices, readLastClient, rememberClient } from "../src/lawoss/lite/client-choice";
import { okfScope } from "../src/lawoss/okf/read-model";
import { NEW_MATTER_PATH } from "../src/lawoss/lite/links";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { chooseClient } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import type { OnboardingProfile } from "../src/lawoss/domains/onboarding/api";
import type { TodayModel } from "../src/lawoss/lite/today-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

/** Rozhodnutie MČ 16. 10. 2026: „Nová vec“ a „Opýtať sa“ z prehľadu praxe sa najprv opýtajú na klienta. */
const ROOT = "/AK/Klienti";
const ws = (id: string, path: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" });
const alfa = ws("alfa", `${ROOT}/ALFA`);
const horak = ws("horak", `${ROOT}/Horak`);
const practice = okfScope([alfa, horak], alfa, ROOT);
const clients = [{ path: "ALFA", title: "ALFA STAV s.r.o." }, { path: "Horak", title: "Horák s.r.o." }];
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const emptyToday: TodayModel = { deadlines: [], tasks: [], inputs: [], recent: [] };

afterEach(() => { try { globalThis.localStorage?.removeItem("lawoss.lastClient"); } catch { /* bez úložiska */ } });

describe("výber klienta v praxi", () => {
  test("klienti praxe s menom z karty; mimo praxe sa nepýta", () => {
    expect(practiceClientChoices(practice, clients)).toEqual([
      { id: "alfa", root: `${ROOT}/ALFA`, title: "ALFA STAV s.r.o." },
      { id: "horak", root: `${ROOT}/Horak`, title: "Horák s.r.o." },
    ]);
    expect(practiceClientChoices(okfScope([alfa], alfa, null), clients)).toEqual([]);
    expect(practiceClientChoices(null)).toEqual([]);
  });

  test("predvolený je naposledy vybraný, inak otvorený, inak prvý", () => {
    const choices = practiceClientChoices(practice, clients);
    expect(defaultClientChoice(choices, "alfa", "horak")?.id).toBe("horak");
    expect(defaultClientChoice(choices, "horak", null)?.id).toBe("horak");
    expect(defaultClientChoice(choices, "iny", "zmazany")?.id).toBe("alfa");
    expect(defaultClientChoice([], "alfa", null)).toBeUndefined();
  });

  test("posledného klienta si zapamätá zariadenie, nie súbor ani server", () => {
    if (!globalThis.localStorage) return;
    rememberClient("horak");
    expect(readLastClient()).toBe("horak");
  });

  test("karta klienta vedie rovno do jeho priečinka; odkaz na formulár nesie klienta", () => {
    expect(clientRootOf(practice, "Horak")).toBe(`${ROOT}/Horak`);
    expect(clientRootOf(practice, "Horak/Spisy")).toBeUndefined();
    expect(clientRootOf(okfScope([alfa], alfa, null), "")).toBeUndefined();
    expect(newMatterLink()).toBe(NEW_MATTER_PATH);
    expect(newMatterLink(`${ROOT}/Horak`)).toBe(`${NEW_MATTER_PATH}&root=${encodeURIComponent(`${ROOT}/Horak`)}`);
  });
});

describe("„+ Nová vec“ v Dnes a v Klientoch", () => {
  const choices = practiceClientChoices(practice, clients);

  test("v praxi tlačidlo otvorí výber, mimo praxe ostáva odkaz na formulár", () => {
    const withPick = html(<TodayView model={emptyToday} locale="sk" choices={choices} activeId="alfa" />);
    expect(withPick).toMatch(/<button[^>]*data-lawoss-new-matter-pick/);
    expect(withPick).not.toContain(`href="${NEW_MATTER_PATH}"`);
    const single = html(<TodayView model={emptyToday} locale="sk" />);
    expect(single).not.toContain("data-lawoss-new-matter-pick");
    expect(single).toContain(`href="${NEW_MATTER_PATH.replace("&", "&amp;")}"`);
  });

  test("prázdna karta klienta ide rovno do svojho klienta bez výberu", () => {
    const out = html(<ClientsView locale="sk" choices={choices} activeId="alfa"
      groups={[{ key: "client:Horak", client: "Horák s.r.o.", matters: [] }]}
      clientRoot={(key) => key === "client:Horak" ? `${ROOT}/Horak` : undefined} />);
    expect(out).toContain(`root=${encodeURIComponent(`${ROOT}/Horak`)}`);
    // Hlavné „+ Nová vec“ na stránke Klienti sa pýta.
    expect(out).toMatch(/<button[^>]*data-lawoss-new-matter-pick/);
  });

  test("prehľad jedného klienta (bočný strom, ?klient=) ide rovno do neho aj z hlavného tlačidla (test 19. 10. 2026)", () => {
    const out = html(<ClientsView locale="sk" choices={choices} activeId="alfa" focus="client:Horak"
      groups={[{ key: "client:Horak", client: "Horák s.r.o.", matters: [{ path: "Horak/Spisy/2026-10 Spor", title: "Spor", deadlines: [] } as never] }, { key: "client:ALFA", client: "ALFA STAV s.r.o.", matters: [] }]}
      clientRoot={(key) => key === "client:Horak" ? `${ROOT}/Horak` : undefined} />);
    expect(out).not.toContain("data-lawoss-new-matter-pick");
    expect(out).toContain(`root=${encodeURIComponent(`${ROOT}/Horak`)}`);
  });
});

describe("formulár novej veci s vybraným klientom", () => {
  const profile = (clientRoot?: string): OnboardingProfile => ({ version: 1, lawyerName: "Syntetický advokát", jurisdiction: "sk", language: "sk", ...(clientRoot ? { clientRoot } : {}) });

  test("vybraný klient sa zapíše do profilu; ten istý klient nič nemení", async () => {
    const calls: unknown[] = [];
    const api = { updateOnboardingProfile: async (patch: Partial<OnboardingProfile>) => { calls.push(patch); return { ...profile(), ...patch }; } };
    expect((await chooseClient(api, profile(`${ROOT}/ALFA`), `${ROOT}/Horak`))?.clientRoot).toBe(`${ROOT}/Horak`);
    expect(calls).toEqual([{ clientRoot: `${ROOT}/Horak`, step: "matter" }]);
    expect(await chooseClient(api, profile(`${ROOT}/Horak/`), `${ROOT}/Horak`)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("odmietnutý klient sa ohlási, nie potichu prepne", async () => {
    const api = { updateOnboardingProfile: async () => { throw new Error("invalid_scope"); } };
    await expect(chooseClient(api, profile(`${ROOT}/ALFA`), `${ROOT}/Iny`)).rejects.toThrow("invalid_scope");
  });
});
