import { describe, expect, test } from "bun:test";
import sk from "../src/i18n/locales/sk";
import cs from "../src/i18n/locales/cs";
import { shellCs, shellSk } from "../src/lawoss/i18n/shell";

// Rozhodnutie MČ 19. 10. 2026: upstream „projekt“ je v SK aj CS rozhraní „klient“ (priečinok klienta)
// a „sesia/relácia“ (SK) / „relace“ (CS) je „chat“. Kľúče (`projects.*`, `sidebar.*_sessions`) ostávajú.
// Strážca pokrýva navigáciu: bočný panel, hľadanie a navigačné kľúče LAWOSS lite. Prefixy sú zámerné,
// aby zachytili aj nové kľúče v bočnom paneli.
const OLD = /projekt|sesi|relác|relac/iu;

const NAV_PREFIXES = ["sidebar.", "content_search.", "lawoss.lite.nav_", "lawoss.lite.tree_"];
const NAV_KEYS = ["projects.plural", "projects.sessions", "projects.recent_sessions", "projects.session_name", "project_chat.untitled_session"];

const isNav = (key: string): boolean => NAV_KEYS.includes(key) || NAV_PREFIXES.some((prefix) => key.startsWith(prefix));

const withOld = (dict: Record<string, string>): string[] =>
  Object.entries(dict).filter(([key, value]) => isNav(key) && OLD.test(value)).map(([key, value]) => `${key}: ${value}`);

const skDict: Record<string, string> = sk;
const csDict: Record<string, string> = cs;

describe("Klient a Chat namiesto projektu a sesie (SK, CS)", () => {
  test("navigácia v SK a CS nehovorí o projekte, sesii ani relácii", () => {
    for (const dict of [skDict, csDict, shellSk, shellCs]) expect(withOld(dict)).toEqual([]);
    // Strážca naozaj niečo kontroluje.
    expect(Object.keys(skDict).filter(isNav).length).toBeGreaterThan(40);
    expect(Object.keys(csDict).filter(isNav).length).toBeGreaterThan(40);
  });

  test("bočný panel: klienti a chaty", () => {
    expect(sk["projects.plural"]).toBe("Klienti");
    expect(cs["projects.plural"]).toBe("Klienti");
    expect(sk["sidebar.pinned_projects"]).toBe("Pripnutí klienti");
    expect(cs["sidebar.pinned_projects"]).toBe("Připnutí klienti");
    expect(sk["sidebar.all_projects"]).toBe("Všetci klienti");
    expect(cs["sidebar.all_projects"]).toBe("Všichni klienti");
    expect(sk["sidebar.pinned_sessions"]).toBe("Pripnuté chaty");
    expect(cs["sidebar.pinned_sessions"]).toBe("Připnuté chaty");
    expect(sk["sidebar.recent_sessions"]).toBe("Nedávne chaty");
    expect(cs["sidebar.recent_sessions"]).toBe("Nedávné chaty");
    expect(sk["sidebar.collapse_sessions"]).toBe("Zbaliť chaty");
    expect(cs["sidebar.collapse_sessions"]).toBe("Sbalit chaty");
    expect(sk["sidebar.pin_project"]).toBe("Pripnúť klienta");
    expect(cs["sidebar.pin_project"]).toBe("Připnout klienta");
    expect(sk["projects.sessions"]).toBe("Chaty");
    expect(cs["projects.sessions"]).toBe("Chaty");
    expect(sk["projects.recent_sessions"]).toBe("Nedávne chaty");
    expect(cs["projects.recent_sessions"]).toBe("Nedávné chaty");
    expect(sk["projects.new_chat"]).toBe("Nový chat");
    expect(sk["project_chat.untitled_session"]).toBe("Nový chat");
    expect(cs["project_chat.untitled_session"]).toBe("Nový chat");
  });

  test("pridať klienta, nie vytvoriť projekt", () => {
    expect(sk["projects.create"]).toBe("Pridať klienta");
    expect(cs["projects.create"]).toBe("Přidat klienta");
    expect(sk["home.new_project"]).toBe("Nový klient");
    expect(cs["home.new_project"]).toBe("Nový klient");
    expect(sk["projects.setup.session_failed"]).toStartWith("Klient bol pridaný.");
    expect(cs["projects.setup.session_failed"]).toStartWith("Klient byl přidán.");
  });

  test("hľadanie: chaty a klienti", () => {
    expect(sk["content_search.sessions"]).toBe("Chaty");
    expect(cs["content_search.sessions"]).toBe("Chaty");
    expect(sk["content_search.projects"]).toBe("Klienti");
    expect(cs["content_search.projects"]).toBe("Klienti");
    expect(sk["content_search.recent"]).toBe("Nedávne chaty a klienti");
    expect(cs["content_search.recent"]).toBe("Nedávné chaty a klienti");
  });

  test("počty: klient je životné mužské", () => {
    const counts = (dict: Record<string, string>, base: string) => ["one", "few", "many", "other"].map((form) => dict[`${base}_${form}`]);
    expect(counts(skDict, "projects.count")).toEqual(["{count} klient", "{count} klienti", "{count} klienta", "{count} klientov"]);
    expect(counts(csDict, "projects.count")).toEqual(["{count} klient", "{count} klienti", "{count} klienta", "{count} klientů"]);
    expect(counts(skDict, "project_filters.project_count")).toEqual(["{count} klient", "{count} klienti", "{count} klienta", "{count} klientov"]);
    expect(counts(csDict, "project_filters.project_count")).toEqual(["{count} klient", "{count} klienti", "{count} klienta", "{count} klientů"]);
  });

  test("strom klientov v LAWOSS lite hovorí o chatoch", () => {
    expect(shellSk["lawoss.lite.tree_new_conversation"]).toBe("Nový chat");
    expect(shellCs["lawoss.lite.tree_new_conversation"]).toBe("Nový chat");
    expect(shellSk["lawoss.lite.client_conversations_title"]).toBe("Chaty klienta");
    expect(shellCs["lawoss.lite.client_conversations_title"]).toBe("Chaty klienta");
  });
});
