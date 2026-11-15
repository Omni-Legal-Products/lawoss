// LAWOSS #442: odstránenie pripojenia z detailu integrácie (dialóg sa hneď zavrie). Zlyhanie aj odstránenie, ktoré
// po limite ešte môže bežať, sa advokátovi ukáže a nevznikne neošetrené odmietnutie promise.
import { expect, test } from "bun:test";
import { t } from "../src/i18n";
import { reportMcpRemoval } from "../src/lawoss/domains/integrations/mcp-removal";

const shown = async (removal: void | false | Promise<void | false>) => {
  const messages: string[] = [];
  await reportMcpRemoval(removal, (message) => messages.push(message));
  return messages;
};

test("#442: výsledok odstránenia z detailu sa ukáže a odmietnutie sa zachytí", async () => {
  expect(await shown(Promise.resolve())).toEqual([]);
  expect(await shown(undefined)).toEqual([]);
  expect(await shown(Promise.resolve(false))).toEqual([t("mcp.remove_failed")]);
  expect(await shown(Promise.reject(new Error(t("lawoss.integrations.remove_pending"))))).toEqual([t("lawoss.integrations.remove_pending")]);
  expect(await shown(Promise.reject("x"))).toEqual([t("common.something_went_wrong")]);
});
