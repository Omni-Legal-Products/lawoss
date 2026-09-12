import { describe, expect, test } from "bun:test";

import type { LegalworkMcpItem, LegalworkSkillItem } from "../src/app/lib/legalwork-server";
import { toConnectorRows } from "../src/lawoss/domains/konektory/rows";

const remote = (name: string, config: Record<string, unknown> = {}): LegalworkMcpItem => ({
  name,
  source: "config.project",
  config: { type: "remote", url: `https://example.test/${name}`, ...config },
});

const skill = (name: string, scope: LegalworkSkillItem["scope"]): LegalworkSkillItem => ({
  name,
  path: `/tmp/${scope}/${name}/SKILL.md`,
  description: `popis ${name}`,
  scope,
});

describe("konektory — mapovanie zo Settings dát", () => {
  test("prázdny vstup dá prázdne sekcie, nie fiktívny zoznam", () => {
    expect(toConnectorRows([], {}, [])).toEqual({ servers: [], skills: [] });
  });

  test("stav servera sleduje opencode mcp.status v poradí ako settings", () => {
    const { servers } = toConnectorRows(
      [
        remote("pripojeny"),
        remote("prihlasenie"),
        remote("registracia"),
        remote("bez-stavu"),
        remote("vypnuty-v-configu", { enabled: false }),
        remote("vypnuty-v-opencode"),
      ],
      {
        pripojeny: { status: "connected" },
        prihlasenie: { status: "needs_auth" },
        registracia: { status: "needs_client_registration", error: "no client" },
        "vypnuty-v-configu": { status: "connected" },
        "vypnuty-v-opencode": { status: "disabled" },
      },
      [],
    );
    expect(servers.map((row) => [row.name, row.status, row.tone])).toEqual([
      ["pripojeny", "pripojené", "ok"],
      ["prihlasenie", "vyžaduje prihlásenie", "warn"],
      ["registracia", "vyžaduje prihlásenie", "warn"],
      ["bez-stavu", "odpojené", "off"],
      ["vypnuty-v-configu", "vypnuté", "off"],
      ["vypnuty-v-opencode", "vypnuté", "off"],
    ]);
    expect(servers.every((row) => row.error === null)).toBe(true);
  });

  test("server s chybou nesie hlášku z opencode", () => {
    const { servers } = toConnectorRows(
      [remote("rozbity")],
      { rozbity: { status: "failed", error: "ECONNREFUSED 127.0.0.1:9999" } },
      [],
    );
    expect(servers).toHaveLength(1);
    expect(servers[0].status).toBe("chyba");
    expect(servers[0].tone).toBe("err");
    expect(servers[0].error).toBe("ECONNREFUSED 127.0.0.1:9999");
  });

  test("zdroj konfigurácie, typ a OAuth sa čítajú z configu ako v mcp-view", () => {
    const { servers } = toConnectorRows(
      [
        remote("oauth"),
        remote("bez-oauth", { oauth: false }),
        { name: "lokalny", source: "config.global", config: { type: "local", command: ["npx", "-y", "server"] } },
        { name: "vzdialeny", source: "config.remote", config: { type: "remote" } },
      ],
      {},
      [],
    );
    expect(servers.map((row) => [row.scope, row.ref, row.sub])).toEqual([
      ["konfigurácia projektu", "remote · OAuth", "https://example.test/oauth"],
      ["konfigurácia projektu", "remote", "https://example.test/bez-oauth"],
      ["globálna konfigurácia", "lokálne", "npx -y server"],
      ["vzdialená konfigurácia", "remote · OAuth", "—"],
    ]);
  });

  test("skills nesú názov, popis a rozsah; workflow je označený", () => {
    const { skills } = toConnectorRows([], {}, [
      skill("novy-spis", "project"),
      { ...skill("tabulka", "global"), kind: "workflow", description: "" },
    ]);
    expect(skills.map((row) => [row.name, row.sub, row.scope, row.ref])).toEqual([
      ["novy-spis", "popis novy-spis", "workspace", "skill"],
      ["tabulka", "bez popisu", "globálne", "workflow"],
    ]);
    expect(new Set(skills.map((row) => row.key)).size).toBe(2);
  });
});

describe("Konektory page contract", () => {
  test("stránka číta z rovnakých volaní ako Settings a nemá fiktívny zoznam", async () => {
    const source = await Bun.file(
      new URL("../src/lawoss/domains/konektory/konektory-page.tsx", import.meta.url),
    ).text();

    expect(source).toContain("listMcp(");
    expect(source).toContain("listSkills(");
    expect(source).toContain("mcp.status(");
    expect(source).toContain("toConnectorRows(");
    expect(source).not.toContain("const CONNECTORS");
    expect(source).not.toContain("Slov-Lex");
  });
});
