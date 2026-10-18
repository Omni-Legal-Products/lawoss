# Synthetic law firm demo

The repeatable fixture in `apps/server/scripts/fixtures/law-firm-wiki.ts` creates **50 clients, 150 matters, 12 processes and 4 template pages**. Each client has three matters. All people, organizations, fees and work descriptions are fictional. The process and Word template content is operational illustration, not legal advice or approved firm content.

The fixed reference date is **11 October 2026**. Dates are internal planning targets. `due_window` is intentionally a stored demo bucket relative to that date, so the examples remain reproducible. It must not be presented as a continuously recalculated statutory deadline.

## Dataset and expected results

| Measure | Expected |
| --- | ---: |
| Clients | 50 |
| Matters | 150 |
| Engagement stages | 5, with 10 clients each |
| Open matters | 110 |
| Overdue internal targets | 31 |
| Targets in the next seven days | 47 |
| Over-budget matters | 15 |
| Simulated budgets | EUR 5,775,000 |
| Simulated recorded fees | EUR 3,938,750 |
| Open matters per partner | 22 each, across five partners |
| Processes / reviews due | 12 / 3 |
| Demo templates | 4 |

Stable page paths are `Clients/C001.md` through `C050.md`, and `Matters/M001.md` through `M150.md`. IDs are `demo-client-001` and `demo-matter-001`, respectively. Every source page has `synthetic: true` and `demo_fixture: law-firm-v1`. Markdown links connect matters, clients, operational processes and templates.

The four adjacent Word documents are `Templates/Engagement-letter.docx`, `Templates/Client-intake.docx`, `Templates/Matter-status-update.docx` and `Templates/Closing-summary.docx`. The builder returns their titles and section specifications so document creation can preserve the same names and source links.

## Four agent prompts

Use the first three in a chat opened inside the demo wiki. The fourth belongs in a project chat with access to that wiki. The agent should call `view_catalog`, discover fields with `wiki_fields`, query with `wiki_query`, and save with `view_create`. Use normal typed tools. Users should not author YAML, JSON envelopes or OpenUI syntax.

### 1. Client portfolio

> In Northstar Law Demo, create and save a live client portfolio dashboard. Use only records marked demo_fixture = law-firm-v1. Show total clients, total matters and recorded fees in EUR; group client cards by engagement_stage in a kanban; show client counts by stage and budget versus fees by practice. Make client cards open their source pages. Save this as a dashboard file, open it in its own tab, and embed its saved reference in Dashboards/Client-portfolio.md. Identify the information as synthetic, referenced to 11 October 2026.

Expected: 50 clients, 150 matters, EUR 3,938,750 fees and ten client cards in each of five stages. Editing a source field updates the live view; the current board groups cards but does not offer drag-to-change-stage.

### 2. Matter control

> Create and save a live matter control dashboard for the synthetic Northstar records. Show open matters, overdue internal targets and over-budget matters. Include workload by partner, a table of overdue targets, a next-seven-days table and a budget-exceptions table. Use the stored open, due_window and budget_status fields; state that these dates are internal demo targets relative to 11 October 2026. Every matter row must open the source. Save a dashboard file and embed its reference in Dashboards/Matter-control.md.

Expected: 110 open, 31 overdue, 47 upcoming and 15 over budget. The real query implementation aggregates the matching dataset before its bounded result page. These examples set row limits high enough to avoid truncating the 150 matters.

### 3. Knowledge library

> Create and save a live knowledge-library dashboard for Northstar's demo_fixture = law-firm-v1 records. Show the 12 processes, four document templates and processes marked Review due. Include owners, review dates and the adjacent Word filename. Link each row to its wiki page; the template guide should link to the editable Word document beside it. Save and embed the dashboard in Dashboards/Knowledge-library.md.

Expected: 12 processes, four demo templates and three reviews due. Built-in starter templates, if the wiki was created with a starter, are outside this fixture.

### 4. Project-owned frozen client briefing

> From this project, read Northstar Law Demo using the authorized wiki tools. Create a frozen briefing for Demo Alder Studio, client ID demo-client-021. Show the client relationship and all three matters, with stages, responsible partners, internal targets, budgets and recorded fees. Save the report in this project, not in the wiki. Preserve each dataset's sourceOwner and source revisions so source links open the wiki pages. Open the report file in its own tab and embed its saved reference in Reports/Client-C021-briefing.md. Make clear that it is a synthetic snapshot.

Expected source records: `Clients/C021.md` and `Matters/M061.md`, `M062.md`, `M063.md`. Client recorded fees are EUR 73,800. Matter budgets are EUR 31,000 / 33,000 / 35,000; fees are EUR 13,950 / 23,100 / 36,750. Changing the wiki later changes a live dashboard but leaves this report's datasets intact.

## Seeding and verification

`buildLawFirmDemo()` returns 217 Markdown files, comprising 216 typed entities and a demo home, plus four attachment specifications. It performs no I/O. `buildDemoViews(indexedPages, wikiId)` returns three live wiki dashboards and one project snapshot, already validated by the real view schema. Use the actual indexed pages when materializing a report so its source revisions match the saved files.

Pass an authorized target to `seedDemoFiles`: its `create` operation must be atomic and create-only, such as a wiki write with `baseRevision: ""` or filesystem `wx`. A second run skips identical files and preserves changed files. `seedDemoViews` reuses this fixture's saved records without replacing edits or snapshot data; ambiguous or non-demo title collisions stop the seed. Save wiki and project views through their respective owner APIs. `demoViewReference` produces an ordinary Markdown page containing only the saved view reference and a link that opens the full tab. Three dashboard embed pages plus an optional wiki report embed make 221 fixture Markdown pages; the project report embed belongs to the project. `buildDemoWikiReport` creates the additional wiki-owned frozen briefing, with owner-relative dataset provenance so it remains portable to shared wiki members.

The seeded wiki also contains a frozen client briefing saved as its own report file. To create the equivalent through an agent, use prompt 4 inside the wiki, replace "in this project, not in the wiki" with "in this wiki", and embed the returned saved reference in Reports/Client-C021-briefing.md.

The focused tests use the real wiki parser, link resolver, query implementation, WikiStore, revision-checked view repository and bundled OpenUI runtime. They verify five saved-view programs (three dashboards and two report owners), exact totals, source ownership, no-overwrite reruns, frozen snapshots after source edits and resolved source links. They do not claim a successful model-generated run or provider latency measurement.

On **11 October 2026**, the fixture was saved through the running server APIs into Northstar Law Demo. Native Electron checks confirmed the portfolio's 50 clients, 150 matters and EUR 3,938,750 fees, ordered stage lanes, inline rendering, source-page navigation, editable adjacent Word documents and restored tabs after restarting the app. The live snapshot had all four DOCX attachments, four wiki-owned view files and no unresolved demo page links. These are seeded data and renderer/query checks, not evidence of model-authored output.

An actual agent generation was attempted on **11 October 2026 at 19:25 UTC**, using the existing connected OpenAI model `gpt-5.6-terra-pro`. The provider rejected it with `AI_APICallError: You have no credits remaining. Add credits to continue using the API`. The session recorded zero input/output tokens and ran zero tools. No dashboard or report was created by that attempt. Provider changes, credit purchases and token workarounds were not attempted. Consequently, actual model-generated partial-program delivery, time to first useful interface, final save transitions, and native approval prompts triggered by a model remain unverified. Automated tests cover the partial-input/tab lifecycle and the real HTTP/plugin approval path separately.

The combined fixture, renderer/catalog, view-tab lifecycle, file classification and view-repository suite passed **51 tests with 381 assertions** on that date.

Run from the repository root:

```sh
pnpm exec bun test apps/server/scripts/fixtures/law-firm-wiki.test.ts packages/openui/src/law-firm-demo.test.tsx
```
