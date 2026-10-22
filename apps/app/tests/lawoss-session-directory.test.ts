import { expect, test } from "bun:test";
import { chatDirectory, effectiveSessionDirectory, isWithinClientFolder } from "../src/lawoss/shell/session-directory";
import { sessionDirectoryWithinWorkspace, sessionsWithinWorkspace } from "../src/react-app/shell/use-workspace-route-state";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const client: RouteWorkspace = { id: "klient-a", name: "Klient_A", displayNameResolved: "Klient_A", path: "/prax/Klient_A", preset: "starter", workspaceType: "local" };
const matter = "/prax/Klient_A/Spisy/M001-Úhrada";

test("chat prípadu beží v priečinku prípadu, chat klienta v koreni klienta", () => {
  expect(effectiveSessionDirectory(client, { directory: matter })).toBe(matter);
  expect(effectiveSessionDirectory(client, { directory: "/prax/Klient_A" })).toBe("/prax/Klient_A");
  expect(effectiveSessionDirectory(client, { directory: "/prax/Klient_A/" })).toBe("/prax/Klient_A/");
  // Bez načítaných metadát chatu: koreň klienta.
  expect(effectiveSessionDirectory(client, null)).toBe("/prax/Klient_A");
  expect(effectiveSessionDirectory(client, { directory: "" })).toBe("/prax/Klient_A");
  expect(effectiveSessionDirectory(null, { directory: matter })).toBe("");
});

test("priečinok mimo klienta nikdy nevyberie: súrodenec s podobným menom, `..`, cudzí klient, vzdialený worker", () => {
  for (const directory of ["/prax/Klient_A2", "/prax/Klient-A/Spis", "/prax/Klient_A/../Klient-A", "/prax/Klient_A/Spisy/../../Klient-A", "/prax", "/"])
    expect({ directory, resolved: effectiveSessionDirectory(client, { directory }) }).toEqual({ directory, resolved: "/prax/Klient_A" });
  expect(effectiveSessionDirectory({ ...client, workspaceType: "remote" }, { directory: matter })).toBe("/prax/Klient_A");
  expect(isWithinClientFolder("/prax/Klient_A", "/prax/Klient_A2/Spis")).toBe(false);
});

test("zhoda nezávisí od NFC/NFD, oddeľovačov a koncovej lomky; vyberie pravopis chatu", () => {
  const nfd = matter.normalize("NFD");
  expect(effectiveSessionDirectory({ ...client, path: "/prax/Klient_A".normalize("NFD") }, { directory: matter })).toBe(matter);
  expect(effectiveSessionDirectory(client, { directory: nfd })).toBe(nfd);
  expect(isWithinClientFolder("C:\\prax\\Klient_A\\", "C:/prax/Klient_A/Spisy/M001")).toBe(true);
  expect(isWithinClientFolder("C:\\prax\\Klient_A", "C:\\prax\\Klient_AB")).toBe(false);
  // Koreň disku ako priečinok klienta.
  expect(isWithinClientFolder("/", "/Spisy/M001")).toBe(true);
});

test("zoznam a vybraný chat trasy používajú to isté pravidlo", () => {
  expect(sessionDirectoryWithinWorkspace(client, { directory: matter })).toBe(matter);
  expect(sessionDirectoryWithinWorkspace(client, { directory: "/prax/Klient-A" })).toBe("/prax/Klient_A");
  expect(sessionsWithinWorkspace(client, [{ id: "a", directory: matter }, { id: "b", directory: "/prax/Klient_A2" }, { id: "c", directory: "/prax/Klient_A/x/../../Klient-A" }] as never))
    .toMatchObject([{ id: "a" }]);
});

test("karta chatu: priečinok z vlastného snapshotu, nikdy z cudzieho; koreň kým sa nenačíta", () => {
  const snapshot = (id: string, directory: string) => ({ session: { id, directory } });
  expect(chatDirectory("/prax/Klient_A", false, "ses_pripad", snapshot("ses_pripad", matter))).toBe(matter);
  expect(chatDirectory("/prax/Klient_A", false, "ses_klient", snapshot("ses_klient", "/prax/Klient_A"))).toBe("/prax/Klient_A");
  // Snapshot iného chatu (napr. práve vybraného prípadu) neplatí pre túto kartu.
  expect(chatDirectory("/prax/Klient_A", false, "ses_klient", snapshot("ses_pripad", matter))).toBe("/prax/Klient_A");
  expect(chatDirectory("/prax/Klient_A", false, "ses_pripad", null)).toBe("/prax/Klient_A");
  expect(chatDirectory("/prax/Klient_A", false, "ses_cudzi", snapshot("ses_cudzi", "/prax/Klient-A/Spis"))).toBe("/prax/Klient_A");
  expect(chatDirectory("/prax/Klient_A", true, "ses_pripad", snapshot("ses_pripad", matter))).toBe("/prax/Klient_A");
});
