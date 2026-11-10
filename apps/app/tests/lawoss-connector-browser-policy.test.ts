// LAWOSS: pravidlá upstream prehliadača integrácií podľa kategórií (v0.3.9), connector-browser-policy.ts.
import { afterEach, expect, test } from "bun:test";
import { areFirmItemsHidden, isNativeConnectorOffered, isNewStorageDisabled, visibleConnectorCategories } from "../src/lawoss/domains/integrations/connector-browser-policy";
import { isLegalworkSourceEnabled, setLegalworkSourceEnabled } from "../src/lawoss/domains/integrations/legalwork-source";
import { connectorCategories } from "../src/react-app/domains/settings/pages/connector-categories";

const initial = isLegalworkSourceEnabled();
afterEach(() => setLegalworkSourceEnabled(initial));

test("natívna pošta a kalendár len so zdrojom LegalWork, úložiská a existujúce pripojenia vždy", () => {
  setLegalworkSourceEnabled(false);
  expect(isNativeConnectorOffered("mail", false)).toBe(false);
  expect(isNativeConnectorOffered("calendar", false)).toBe(false);
  expect(isNativeConnectorOffered("mail", true)).toBe(true);
  expect(isNativeConnectorOffered("files", false)).toBe(true);
  setLegalworkSourceEnabled(true);
  expect(isNativeConnectorOffered("mail", false)).toBe(true);
});

test("nové úložisko je v alfe vyblednuté, existujúce sa dá spravovať; firemný hub a kategória Eigenwelt skryté", () => {
  expect(isNewStorageDisabled(true, false)).toBe(true);
  expect(isNewStorageDisabled(true, true)).toBe(false);
  expect(isNewStorageDisabled(false, false)).toBe(false);
  expect(areFirmItemsHidden()).toBe(true);
  setLegalworkSourceEnabled(false);
  expect(visibleConnectorCategories(connectorCategories)).not.toContain("eigenwelt");
  setLegalworkSourceEnabled(true);
  expect(visibleConnectorCategories(connectorCategories)).toContain("eigenwelt");
});
