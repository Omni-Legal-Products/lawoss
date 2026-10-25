import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { LinkedFoldersNavView, requestLinkFolder, takeLinkFolderRequest, focusLinkedFolders } from "../src/lawoss/lite/linked-folders-view";

// N-A5-11 (UI test dev 25. 10. 2026): drobnosti v navigácii. Prvé kliknutie na klienta otvorilo prázdny
// „Pracovný priestor“, hlavička klienta na stránke „Klienti a prípady“ nebola odkaz a „+“ pri „Pripojené priečinky“
// otvorilo len Prehľad, nie výber priečinka.

const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const groups = [{ key: "client:Horak", client: "Horák s.r.o.", matters: [] }, { key: "client:ALFA", client: "ALFA STAV s.r.o.", matters: [] }];

/** `onClick` tlačidla v strome prvkov (bez DOM; SSR kliknutie nespustí). */
function clickOf(node: ReactNode): (() => void) | undefined {
  if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return undefined;
  if (node.props.onClick) return node.props.onClick;
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) { const found = clickOf(child); if (found) return found; }
  return undefined;
}

describe("N-A5-11: navigácia", () => {
  test("hlavička klienta na stránke Klienti a prípady vedie na jeho prehľad", () => {
    const out = html(<ClientsView locale="sk" groups={groups} />);
    expect(out).toMatch(/<h2><a class="lw-clients-card-link" href="\/klienti\?klient=client%3AHorak"[^>]*>Horák s\.r\.o\.<\/a><\/h2>/);
    // Na prehľade toho istého klienta hlavička nie je odkaz na seba.
    const focused = html(<ClientsView locale="sk" groups={groups} focus="client:Horak" />);
    expect(focused).not.toContain(`klient=${encodeURIComponent("client:Horak")}"`);
  });

  test("„+“ pri pripojených priečinkoch (bez priečinkov) otvorí výber priečinka, s priečinkami len Prehľad", () => {
    const calls: string[] = [];
    const view = (count: number) => LinkedFoldersNavView({ locale: "sk", count, onOpen: () => calls.push("open"), onAdd: () => calls.push("add") });
    clickOf(view(0))?.();
    clickOf(view(2))?.();
    expect(calls).toEqual(["add", "open"]);
  });

  test("žiadosť o výber priečinka platí raz a len pre toho klienta", () => {
    requestLinkFolder("c001");
    expect(takeLinkFolderRequest("c002")).toBe(false);
    expect(takeLinkFolderRequest("c001")).toBe(true);
    expect(takeLinkFolderRequest("c001")).toBe(false);
    // Review: žiadosť, ktorú Domov nevybavil, zanikne odchodom a neotvorí výber neskôr sama.
    requestLinkFolder("c001");
    focusLinkedFolders(null);
    focusLinkedFolders("c001");
    expect(takeLinkFolderRequest("c001")).toBe(false);
    focusLinkedFolders(null);
    // Domov klienta žiadosť vezme, keď je sekcia pripravená, a zahodí ju, keď sa vybrať nedá (strážca väzby; SSR
    // efekty nespúšťa).
    const source = readFileSync(join(import.meta.dir, "../src/lawoss/lite/linked-folders-view.tsx"), "utf8");
    expect(source).toContain("if (canPick) { if (takeLinkFolderRequest(workspaceId)) onLink(); }");
    expect(source).toContain("else if (!endpoint || policy.locked || !isDesktopRuntime() || query.isError) takeLinkFolderRequest(workspaceId);");
  });

  test("klik na klienta v bočnom paneli otvorí Prehľad, v Lite aj pred načítaním prehľadu (strážca väzby)", () => {
    // `WorkspaceHeader` nie je exportovaný a panel potrebuje celý kontext appky; väzbu stráži zdroj.
    const sidebar = readFileSync(join(import.meta.dir, "../src/react-app/domains/session/sidebar/app-sidebar.tsx"), "utf8");
    expect(sidebar).toContain(`const openHome = useUiMode() === "lite" || clientRow.client;`);
    expect(sidebar).toContain(`void (openHome ? ctx.onOpenProjectPage(workspace.id, "home") : ctx.onOpenWorkspace(workspace.id))`);
  });
});
