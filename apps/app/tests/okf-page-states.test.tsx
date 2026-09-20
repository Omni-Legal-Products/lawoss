import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { PrehladPage } from "../src/lawoss/domains/prehlad/prehlad-page";
import { LehotyPage } from "../src/lawoss/domains/lehoty/lehoty-page";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { buildOverview } from "../../../lawoss/okf/read";

for (const Page of [PrehladPage, LehotyPage]) {
  test(`${Page.name}: startup never displays fictional cases or deadlines`, () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><Page /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(html).not.toContain("fiktívne dáta");
    expect(html).not.toContain("ABC s.r.o.");
    expect(html).toContain("Načítavam");
    expect(html).toContain("Skúsiť znova");
  });
}

const empty = { ...buildOverview([], "2026-09-20"), problems: [], truncated: false, inputs: [] };

test("missing connection is unavailable, not an empty workspace", () => {
  const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="unavailable" workspace={null} error={null} data={empty} loading={false}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
  expect(html).toContain("Server zatiaľ nie je dostupný");
  expect(html).not.toContain("dashboard");
  expect(html).not.toContain("Založiť nový spis");
});

test("no workspace offers opening a folder, and a readable empty folder offers a new matter", () => {
  const render = (workspace: string | null) => renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace={workspace} error={null} data={empty} loading={false}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
  expect(render(null)).toContain("Otvoriť pracovný priečinok");
  expect(render(null)).not.toContain("Založiť nový spis");
  expect(render("Moje spisy")).toContain("Založiť nový spis");
  expect(render("Moje spisy")).not.toContain("dashboard");
});

test("failed discovery never claims that the folder has no matters", () => {
  const data = { ...empty, problems: [{ path: "AK", message: "Prístup odmietnutý" }] };
  const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace="Moje spisy" error={null} data={data} loading={false}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
  expect(html).toContain("Prístup odmietnutý");
  expect(html).toContain("nedá určiť");
  expect(html).not.toContain("Založiť nový spis");
});

test("query failure suppresses cached overview rather than presenting it as current", () => {
  const data = { ...empty, ...buildOverview([{ path: "case", records: [] }], "2026-09-20") };
  const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace="Moje spisy" error={new Error("Connection lost")} data={data} loading={false}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
  expect(html).toContain("Connection lost");
  expect(html).not.toContain("dashboard");
  expect(html).not.toContain("Založiť nový spis");
});
