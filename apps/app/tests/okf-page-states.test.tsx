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
    expect(html).not.toContain("fictional data");
    expect(html).not.toContain("ABC s.r.o.");
    expect(html).toContain("Loading the connection and workspaces");
    expect(html).toContain("Try again");
  });
}

const empty = { ...buildOverview([], "2026-09-20"), problems: [], truncated: false, inputs: [] };

test("missing connection is unavailable, not an empty workspace", () => {
  const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="unavailable" workspace={null} error={null} data={empty} loading={false}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
  expect(html).toContain("The server is not available yet");
  expect(html).not.toContain("dashboard");
  expect(html).not.toContain("Create a new matter");
});

test("no workspace offers opening a folder, and a readable empty folder offers a new matter", () => {
  const render = (workspace: string | null) => renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace={workspace} error={null} data={empty} loading={false}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
  expect(render(null)).toContain("Open a workspace");
  expect(render(null)).not.toContain("Create a new matter");
  expect(render("Moje spisy")).toContain("Create a new matter");
  expect(render("Moje spisy")).not.toContain("dashboard");
});

test("failed discovery never claims that the folder has no matters", () => {
  const data = { ...empty, problems: [{ path: "AK", message: "Prístup odmietnutý" }] };
  const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace="Moje spisy" error={null} data={data} loading={false}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
  expect(html).toContain("Prístup odmietnutý");
  expect(html).toContain("cannot establish whether the workspace contains matters");
  expect(html).not.toContain("Create a new matter");
});

test("lite hides raw per-file read errors but still reports the incomplete read", () => {
  const data = { ...empty, problems: [{ path: "", message: "Workspace not found" }] };
  const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace="Testovací kancelář" error={null} data={data} loading={false} rawProblems={false}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
  expect(html).not.toContain("Workspace not found");
  expect(html).toContain("cannot establish whether the workspace contains matters");
  expect(html).not.toContain("dashboard");
});

test("query failure suppresses cached overview rather than presenting it as current", () => {
  const data = { ...empty, ...buildOverview([{ path: "case", records: [] }], "2026-09-20") };
  const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace="Moje spisy" error={new Error("Connection lost")} data={data} loading={false}>{() => "dashboard"}</OkfPageState></MemoryRouter>);
  expect(html).toContain("Could not load matter memory: Connection lost");
  expect(html).not.toContain("dashboard");
  expect(html).not.toContain("Create a new matter");
});
