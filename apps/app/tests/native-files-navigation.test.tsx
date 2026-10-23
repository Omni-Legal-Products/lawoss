import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DOMParser } from "@xmldom/xmldom";
import { Button } from "../src/components/ui/button";
import { SidebarMenuButton, SidebarMenuSubButton, SidebarProvider } from "../src/components/ui/sidebar";
import { t } from "../src/i18n";
import { fixture, workspace } from "../../../lawoss/testing/isir/native/project-files-navigation-fixture.mjs";

// Same primitives/props as WorkspaceHeader and WorkspaceSidebarGroup. Render
// their real Base UI state attributes; do not manufacture aria-pressed/expanded
// on the title. The VM runs the real navigation and chooser expressions, while
// its owned pane and click handlers remain synthetic (not native layout proof).
function renderControls({expanded,active,selected}: {expanded:boolean;active:boolean;selected:boolean}) {
  const html = renderToStaticMarkup(<SidebarProvider>
    <SidebarMenuButton isActive={selected} aria-current={selected ? "location" : undefined}>{workspace.name}</SidebarMenuButton>
    <Button variant="ghost" size="icon" aria-label={t(expanded ? "sidebar.collapse" : "sidebar.expand", "en")} aria-expanded={expanded} />
    <SidebarMenuSubButton isActive={active}>{t("projects.files", "en")}</SidebarMenuSubButton>
  </SidebarProvider>);
  const document = new DOMParser().parseFromString(html, "text/html");
  const controls = [...document.getElementsByTagName("button")];
  const attributes = (slot: string) => {
    const matches = controls.filter(node => node.getAttribute("data-slot") === slot);
    expect(matches).toHaveLength(1);
    return Object.fromEntries([...matches[0].attributes].map(attribute => [attribute.name,attribute.value]));
  };
  return {title:attributes("sidebar-menu-button"),expand:attributes("button"),files:attributes("sidebar-menu-sub-button")};
}

test("rendered production sidebar keeps already-active Files open without clicking the workspace title", async () => {
  const f = fixture({renderControls});
  expect(f.title.getAttribute("aria-expanded")).toBeNull();
  expect(f.files.getAttribute("aria-pressed")).toBeNull();
  expect(f.files.getAttribute("data-active")).toBe("");
  await f.run();
  await f.run();
  expect(f.state.titles).toBe(0);
  expect(f.state.expansions).toBe(0);
  expect(f.state.toggles).toBe(0);
});

test("rendered production chevron expands before inactive Files activates and stays idempotent", async () => {
  const f = fixture({renderControls,expanded:false,foreign:true,open:false,folder:"Dokumenty"});
  expect(f.files.getAttribute("data-active")).toBeNull();
  await f.run();
  await f.run();
  expect(f.state.selected).toBe(workspace.id);
  expect(f.state.titles).toBe(0);
  expect(f.state.expansions).toBe(1);
  expect(f.state.toggles).toBe(1);
  expect(f.state.roots).toBe(1);
  // A later real navigation away removes the boolean attribute, and must be
  // reactivated exactly once instead of trusting the retained panel.
  f.state.open=false;
  f.sync();
  await f.run();
  expect(f.state.toggles).toBe(2);
});

test("LAWOSS client row: card name and status line keep exact native-name matching on the label element", async () => {
  const f = fixture({renderControls,expanded:false,foreign:true,open:false,folder:"Dokumenty",displayName:"SYN Native Case, s. r. o."});
  expect(f.title.textContent).not.toBe(workspace.name);
  await f.run();
  expect(f.state.selected).toBe(workspace.id);
  expect(f.state.expansions).toBe(1);
  expect(f.state.toggles).toBe(1);
  expect(f.state.titles).toBe(0);
});
