// LAWOSS #442: odstránenie pripojenia z detailu adresára (dialóg sa hneď zavrie) nesmie skončiť neošetreným
// zamietnutím promise; advokát vidí hlášku (toast), aj keď odstránenie po limite ešte beží.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { t } from "../src/i18n";
import { settleMcpRemoval } from "../src/lawoss/domains/integrations/mcp-removal";

describe("#442 settleMcpRemoval", () => {
  test("po limite povie, že odstránenie ešte môže prebiehať, a nevyhodí výnimku", async () => {
    const reported: string[] = [];
    const pending = Promise.reject(new Error(t("lawoss.integrations.remove_pending")));
    await expect(settleMcpRemoval(pending, (message) => reported.push(message))).resolves.toBeUndefined();
    expect(reported).toEqual([t("lawoss.integrations.remove_pending")]);
  });

  test("návrat false je zlyhanie odstránenia, úspech nič nehlási", async () => {
    const reported: string[] = [];
    await settleMcpRemoval(Promise.resolve(false), (message) => reported.push(message));
    await settleMcpRemoval(Promise.resolve(), (message) => reported.push(message));
    await settleMcpRemoval(undefined, (message) => reported.push(message));
    expect(reported).toEqual([t("mcp.remove_failed")]);
  });

  test("výnimka bez textu má všeobecnú hlášku", async () => {
    const reported: string[] = [];
    await settleMcpRemoval(Promise.reject("boom"), (message) => reported.push(message));
    expect(reported).toEqual([t("mcp.remove_failed")]);
  });

  test("detail adresára v Nastaveniach odstránenie ošetrí", () => {
    const source = readFileSync(new URL("../src/react-app/domains/settings/pages/mcp-view.tsx", import.meta.url), "utf8");
    expect(source).toContain("void settleMcpRemoval(props.removeMcp(slug), message => toast.error(message));");
    expect(source).not.toMatch(/^\s*props\.removeMcp\(slug\);/m);
  });
});
