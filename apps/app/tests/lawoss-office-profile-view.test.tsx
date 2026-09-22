import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OfficeProfileEditor, OfficeProfileView } from "../src/lawoss/domains/settings/office-profile-view";
import { workingProfile } from "../../../lawoss/okf/src/profile";
import { NovySpisPanel } from "../src/lawoss/domains/novy-spis/novy-spis-page";

test("native office editor exposes folder roles and prevents read-only edits", () => {
  const unused = async (): Promise<never> => { throw new Error("SSR must not call server"); };
  const html = renderToStaticMarkup(<OfficeProfileEditor client={{ readWorkspaceFile: unused, writeWorkspaceFile: unused, statWorkspaceFile: unused }} workspaceId="office" initial={{ path: "Office/okf.config", content: null, value: { profile: workingProfile(), clientPath: "" } }} writable={false} onReload={() => {}} />);
  expect(html).toContain("Podklady od klienta");
  expect(html).toContain("Vzor názvu nového dokumentu");
  expect(html).toContain('fieldset disabled=""');
});
test("disconnected profile settings do not offer a writable form", () => {
  const html = renderToStaticMarkup(<OfficeProfileView client={null} workspaceId={null} workspacePath="" workspaceName="" />);
  expect(html).toContain("Vyberte pripojený lokálny priečinok kancelárie");
  expect(html).not.toContain("Uložiť profil");
});
test("native creation panel shows the same author used for document changes", () => {
  const html = renderToStaticMarkup(<NovySpisPanel documentAuthor="Test Advokát" connection={{ client: null, baseUrl: "", token: "" }} workspace={{ id: "one", name: "Office", path: "/office", workspaceType: "local" }} onOpenSession={() => {}} />);
  expect(html).toContain("Test Advokát");
  expect(html).not.toContain("Meno nie je nastavené");
});
