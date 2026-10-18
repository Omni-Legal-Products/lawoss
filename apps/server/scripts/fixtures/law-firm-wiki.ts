import { createHash } from "node:crypto";
import { markdownWithData, parseWikiPage, resolveWikiLinks } from "../../src/wiki/markdown.js";
import { queryWikiPages } from "../../src/wiki/data-query.js";
import type { WikiPage, WikiValue } from "@legalwork/types/wiki";
import { ViewInputSchema, type ViewInput, type ViewOwner, type ViewRecord, type WikiDataQuery } from "@legalwork/types/views";

export const DEMO_FIXTURE = "law-firm-v1";
export const DEMO_AS_OF = "2026-10-11";
const epoch = Date.parse(`${DEMO_AS_OF}T12:00:00Z`);
export type DemoFile = { path: string; content: string };
export type DemoDocx = { path: string; title: string; sections: { heading: string; text: string }[] };
export type DemoView = { key: string; scope: "wiki" | "project"; referencePath: string; input: ViewInput };
const practices = ["Corporate", "Commercial", "Employment", "Disputes", "Real estate"];
const sectors = ["Technology", "Manufacturing", "Professional services", "Retail", "Renewable energy"];
const partners = ["Partner Alder", "Partner Birch", "Partner Cedar", "Partner Linden", "Partner Rowan"];
const stages = ["Prospect", "Onboarding", "Active", "Retainer", "Dormant"];
const names = ["Alder", "Birch", "Cedar", "Elm", "Hazel", "Juniper", "Linden", "Maple", "Rowan", "Willow"];
const businesses = ["Systems", "Works", "Studio", "Supply", "Energy"];
const matterStages = [
  ["Intake", "Scoping", "On hold"],
  ["Intake", "Scoping", "Awaiting documents"],
  ["In progress", "Awaiting client", "Partner review"],
  ["In progress", "Partner review", "Complete"],
  ["Complete", "Complete", "Archived"],
];
const work = [
  ["Ownership register review", "Board pack preparation", "Transaction coordination"],
  ["Supply agreement review", "Customer terms refresh", "Vendor contract renewal"],
  ["People policy refresh", "Employment document review", "HR project coordination"],
  ["Case file organization", "Evidence register review", "Settlement project tracking"],
  ["Lease document review", "Property file coordination", "Portfolio document update"],
];
const processes = [
  ["P01-Client-intake", "Client intake", "Operations", "Collect the requested contact and organization details, identify missing information, and record the internal owner.", "Client-intake"],
  ["P02-Conflict-review-routing", "Conflict review routing", "Risk team", "Prepare the party list and route it to the firm's designated reviewer. The demo does not decide whether a conflict exists.", "Client-intake"],
  ["P03-Engagement-setup", "Engagement setup", "Operations", "Record the approved scope, relationship owner and engagement status after the responsible reviewer confirms them.", "Engagement-letter"],
  ["P04-Matter-opening", "Matter opening", "Operations", "Create the matter record, link its client, identify the responsible partner and record the agreed budget.", "Client-intake"],
  ["P05-Document-request-tracking", "Document request tracking", "Matter team", "Maintain a list of requested documents, received versions and outstanding owners. Preserve source links.", "Matter-status-update"],
  ["P06-Deadline-check-in", "Deadline check-in", "Matter team", "Review internal target dates with the responsible team. Statutory or court deadlines require separate professional verification.", "Matter-status-update"],
  ["P07-Partner-review-handoff", "Partner review handoff", "Practice lead", "Prepare the current work product, unresolved questions and exact source locations for the assigned partner.", "Matter-status-update"],
  ["P08-Client-update", "Client update", "Relationship partner", "Prepare a factual status summary, current next steps and items awaiting a client response. Send only after approval.", "Matter-status-update"],
  ["P09-Budget-check-in", "Budget check-in", "Finance", "Compare recorded fees with the approved budget, explain variance and route potential scope changes to the owner.", "Matter-status-update"],
  ["P10-Matter-closing", "Matter closing", "Matter team", "Record completion, outstanding operational tasks, document locations and the responsible closing reviewer.", "Closing-summary"],
  ["P11-Template-maintenance", "Template maintenance", "Knowledge team", "Keep the master document version and owner visible. Work from a copy and route proposed changes for review.", "Engagement-letter"],
  ["P12-Knowledge-review", "Knowledge review", "Knowledge team", "Summarize reusable operational learning, remove client identifiers and request human review before publication.", "Closing-summary"],
];
const templates = [
  { key: "Engagement-letter", title: "Engagement letter", process: 2, sections: ["Approved engagement scope", "Responsible team", "Commercial terms to confirm", "Review and approval"] },
  { key: "Client-intake", title: "Client intake", process: 0, sections: ["Synthetic organization details", "Contact and relationship owner", "Requested work", "Information still required"] },
  { key: "Matter-status-update", title: "Matter status update", process: 7, sections: ["Current stage", "Completed operational work", "Next internal target", "Budget and open questions"] },
  { key: "Closing-summary", title: "Closing summary", process: 9, sections: ["Synthetic matter summary", "Work product locations", "Outstanding operational tasks", "Review and archive owner"] },
];
const pad = (value: number) => String(value).padStart(3, "0");
export const demoClientPath = (number: number) => `Clients/C${pad(number)}.md`;
export const demoMatterPath = (number: number) => `Matters/M${pad(number)}.md`;
const date = (offset: number) => new Date(epoch + offset * 86_400_000).toISOString().slice(0, 10);
const link = (path: string, title?: string) => `[[${path}${title ? `|${title}` : ""}]]`;
function page(path: string, properties: Record<string, WikiValue>, body: string): DemoFile {
  return { path, content: markdownWithData(body.trim() + "\n", { ...properties, demo_fixture: DEMO_FIXTURE, synthetic: true }) };
}

/** Pure, deterministic fixture construction. It does not touch a live wiki or filesystem. */
export function buildLawFirmDemo(): { files: DemoFile[]; attachments: DemoDocx[] } {
  const files: DemoFile[] = [];
  for (let client = 1; client <= 50; client++) {
    const group = Math.floor((client - 1) / 10), practice = (client - 1) % practices.length;
    const title = `Demo ${names[(client - 1) % 10]} ${businesses[group]}`;
    const matterPaths: string[] = [];
    let budget = 0, fees = 0;
    for (let slot = 0; slot < 3; slot++) {
      const number = (client - 1) * 3 + slot + 1, stage = matterStages[group][slot];
      const closed = stage === "Complete" || stage === "Archived";
      const matterBudget = 10_000 + client * 1_000 + slot * 2_000 + practice * 500;
      const ratio = stage === "Awaiting documents" ? 10 : stage === "In progress" ? (number % 4 === 0 ? 115 : 45)
        : stage === "Awaiting client" ? 70 : stage === "Partner review" ? (number % 3 === 0 ? 105 : 90) : closed ? 100 : 0;
      const matterFees = matterBudget * ratio / 100;
      const offset = closed ? -30 - number % 20 : [-4, -1, 0, 2, 5, 9, 15][(number - 1) % 7];
      const dueWindow = closed ? "Completed" : offset < 0 ? "Overdue" : offset <= 7 ? "Next 7 days" : "Later";
      const path = demoMatterPath(number), process = processes[closed ? 9 : stage === "Partner review" ? 6 : stage === "Intake" ? 0 : 5];
      matterPaths.push(path); budget += matterBudget; fees += matterFees;
      files.push(page(path, {
        id: `demo-matter-${pad(number)}`, type: "matter", title: `M${pad(number)} · ${work[practice][slot]} · ${title}`,
        client_id: `demo-client-${pad(client)}`, client: link(demoClientPath(client), title), practice: practices[practice],
        partner: partners[(client + slot - 1) % partners.length], stage, open: !closed, currency: "EUR",
        budget_eur: matterBudget, fees_eur: matterFees, budget_status: matterFees > matterBudget ? "Over budget" : "Within budget",
        internal_due: date(offset), due_window: dueWindow, priority: !closed && (offset < 0 || matterFees > matterBudget) ? "High" : "Normal",
        opened_on: date(-180 - client * 2 - slot * 9), as_of: DEMO_AS_OF,
        process: link(`Processes/${process[0]}.md`, process[1]), template: link(`Templates/${closed ? "Closing-summary" : "Matter-status-update"}.md`),
      }, `# M${pad(number)} · ${work[practice][slot]}\n\nSynthetic matter for ${link(demoClientPath(client), title)}. This record is demo data, not a real engagement.\n\n## Current position\n\nStage: **${stage}**. The ${practices[practice].toLowerCase()} team records simulated fees of EUR ${matterFees.toLocaleString("en-US")} against a EUR ${matterBudget.toLocaleString("en-US")} budget.\n\nThe date ${date(offset)} is an **internal demo target**, not a statutory, contractual or court deadline. The due-window label is fixed relative to ${DEMO_AS_OF}.\n\n## Next operational step\n\n${closed ? "Confirm the closing checklist and preserve the final source locations." : stage === "On hold" ? "Confirm whether this proposed scope should resume before allocating work." : "Confirm the next owner and outstanding documents at the next team check-in."}\n\nFollow ${link(`Processes/${process[0]}.md`, process[1])}. Prepare updates using ${link("Templates/Matter-status-update.md", "the status template")}.\n\n## Related matters\n\n${[0, 1, 2].filter(other => other !== slot).map(other => `- ${link(demoMatterPath((client - 1) * 3 + other + 1))}`).join("\n")}`));
    }
    files.push(page(demoClientPath(client), {
      id: `demo-client-${pad(client)}`, type: "client", title, engagement_stage: stages[group], sector: sectors[practice],
      practice: practices[practice], partner: partners[practice], country: ["Germany", "Austria", "Netherlands", "Denmark", "Sweden"][practice],
      currency: "EUR", matter_count: 3, budget_eur: budget, fees_eur: fees, relationship_since: date(-365 - client * 17),
      next_review: date(2 + client % 21), as_of: DEMO_AS_OF, matters: matterPaths.map(path => link(path)),
    }, `# ${title}\n\n**Synthetic demo client.** No real organization, person or engagement is represented.\n\nThis ${sectors[practice].toLowerCase()} organization is in the **${stages[group]}** engagement stage. ${partners[practice]} owns the relationship.\n\n## Matters\n\n${matterPaths.map(path => `- ${link(path)}`).join("\n")}\n\n## Working references\n\n- ${link("Processes/P01-Client-intake.md", "Client intake")}\n- ${link("Processes/P08-Client-update.md", "Client updates")}\n- ${link("Templates/Engagement-letter.md", "Engagement template")}`));
  }
  processes.forEach(([key, title, owner, description, template], index) => files.push(page(`Processes/${key}.md`, {
    id: `demo-process-${pad(index + 1)}`, type: "process", title, owner, status: index % 4 === 0 ? "Review due" : "Current",
    last_reviewed: date(-30 - index * 10), next_review: date(index % 4 === 0 ? -2 : 14 + index),
    template: link(`Templates/${template}.md`), as_of: DEMO_AS_OF,
  }, `# ${title}\n\nSynthetic operational process for the demo firm. This is not legal advice or an approved firm policy.\n\n${description}\n\n## Example sequence\n\n1. Confirm the scope and record the responsible person.\n2. Gather the current source records and note missing information.\n3. Route the prepared work to the responsible human reviewer.\n4. Record the approved next step and link the source materials.\n\n## Related references\n\n- ${link(`Templates/${template}.md`, "Relevant document template")}\n- ${link(`Processes/${processes[(index + 1) % processes.length][0]}.md`, "Next related process")}\n- ${link(demoMatterPath(61 + index), "Example synthetic matter")}`)));
  const attachments = templates.map(template => ({ path: `Templates/${template.key}.docx`, title: template.title,
    sections: [{ heading: "Synthetic demo only", text: "This is a fictional operational document for LegalWork demonstration. It contains no legal clauses or advice. Use a copy; do not treat it as approved firm content." }, ...template.sections.map(heading => ({ heading, text: `[Demo placeholder: ${heading.toLowerCase()}. Confirm the responsible reviewer before using this in real work.]` }))] }));
  templates.forEach((template, index) => files.push(page(`Templates/${template.key}.md`, {
    id: `demo-template-${pad(index + 1)}`, type: "template", title: template.title, owner: "Knowledge team", status: "Demo only", version: "1.0",
    document: `${template.key}.docx`, process: link(`Processes/${processes[template.process][0]}.md`), as_of: DEMO_AS_OF,
  }, `# ${template.title}\n\n**Synthetic demo template.** This document contains operational placeholders, not legal advice or approved clauses.\n\n[Open the adjacent Word document](${template.key}.docx)\n\nUse a copy of the Word document for a matter. Keep this master next to its wiki page so the metadata, process notes and editable document stay connected.\n\n## Contents\n\n${template.sections.map(section => `- ${section}`).join("\n")}\n\n## Process\n\n${link(`Processes/${processes[template.process][0]}.md`, processes[template.process][1])}`)));
  files.push(page("Demo-home.md", { id: "demo-home", type: "page", title: "Synthetic law firm demo", as_of: DEMO_AS_OF }, `# Synthetic law firm demo\n\nEverything in this fixture is fictional. It contains **50 clients, 150 matters, 12 operational processes and 4 template pages**, each with an adjacent Word document. No real client information is included. Process and template content is illustrative, not legal advice or approved firm policy.\n\nThe fixed reference date is **${DEMO_AS_OF}**. All fee figures are simulated EUR amounts. Dates are internal planning targets. Due-window labels remain relative to this reference date until the demo data is deliberately changed.\n\n## Start here\n\n- ${link("Dashboards/Client-portfolio.md", "Client portfolio and engagement board")}\n- ${link("Dashboards/Matter-control.md", "Matter deadlines, workload and budgets")}\n- ${link("Dashboards/Knowledge-library.md", "Process and template library")}\n- ${link(demoClientPath(21), "Example active client: Demo Alder Studio")}\n- ${link("Templates/Engagement-letter.md", "Word template beside its wiki page")}\n\nA project agent with access to this wiki can create a **private frozen client briefing report in its project**. That report should retain wiki source ownership so its source links open the wiki pages.\n\n## Demo convention\n\nEvery client has exactly three matters. Prospect matters are potential scopes with no recorded fees. Dormant clients have completed or archived work. Indexed fields drive the views; editing source fields updates live dashboards, while saved report snapshots remain frozen.`));
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), attachments };
}

export function indexLawFirmDemo(files = buildLawFirmDemo().files): WikiPage[] {
  return resolveWikiLinks(files.map(file => parseWikiPage(file.path, file.content, createHash("sha256").update(file.content).digest("hex"), epoch).page));
}
const fixtureFilters: NonNullable<WikiDataQuery["filters"]> = [{ field: "properties.demo_fixture", op: "eq", value: DEMO_FIXTURE }];
const allClients: WikiDataQuery = { pageType: "client", filters: fixtureFilters, fields: ["title", "properties.engagement_stage", "properties.partner", "properties.fees_eur", "properties.sector"], sort: [{ field: "title", direction: "asc" }], limit: 200 };
const allMatters: WikiDataQuery = { pageType: "matter", filters: fixtureFilters, fields: ["title", "properties.client_id", "properties.stage", "properties.partner", "properties.internal_due", "properties.due_window", "properties.budget_eur", "properties.fees_eur"], limit: 200 };
const opened: NonNullable<WikiDataQuery["filters"]> = [...fixtureFilters, { field: "properties.open", op: "eq", value: true }];
export const DEMO_QUERIES = {
  clients: allClients,
  matters: allMatters,
  stage: { pageType: "client", filters: fixtureFilters, fields: ["properties.engagement_stage", "clients"], groupBy: "properties.engagement_stage", metrics: [{ name: "clients", op: "count" }], limit: 200 },
  money: { pageType: "matter", filters: fixtureFilters, fields: ["budget", "fees"], metrics: [{ name: "budget", op: "sum", field: "properties.budget_eur" }, { name: "fees", op: "sum", field: "properties.fees_eur" }] },
  practice: { pageType: "matter", filters: fixtureFilters, fields: ["properties.practice", "budget", "fees"], groupBy: "properties.practice", metrics: [{ name: "budget", op: "sum", field: "properties.budget_eur" }, { name: "fees", op: "sum", field: "properties.fees_eur" }], sort: [{ field: "properties.practice", direction: "asc" }] },
  open: { ...allMatters, filters: opened },
  overdue: { ...allMatters, filters: [...opened, { field: "properties.due_window", op: "eq", value: "Overdue" }], sort: [{ field: "properties.internal_due", direction: "asc" }] },
  upcoming: { ...allMatters, filters: [...opened, { field: "properties.due_window", op: "eq", value: "Next 7 days" }], sort: [{ field: "properties.internal_due", direction: "asc" }] },
  overBudget: { ...allMatters, filters: [...fixtureFilters, { field: "properties.budget_status", op: "eq", value: "Over budget" }], sort: [{ field: "properties.fees_eur", direction: "desc" }] },
  partners: { pageType: "matter", fields: ["properties.partner", "open_matters"], filters: opened, groupBy: "properties.partner", metrics: [{ name: "open_matters", op: "count" }], sort: [{ field: "properties.partner", direction: "asc" }] },
  processes: { pageType: "process", filters: fixtureFilters, fields: ["title", "properties.owner", "properties.status", "properties.next_review"], limit: 200 },
  templates: { pageType: "template", filters: fixtureFilters, fields: ["title", "properties.owner", "properties.status", "properties.document"], limit: 200 },
  reviewDue: { pageType: "process", fields: ["title", "properties.owner", "properties.next_review"], filters: [...fixtureFilters, { field: "properties.status", op: "eq", value: "Review due" }], limit: 200 },
  client21: { ...allClients, filters: [...fixtureFilters, { field: "properties.id", op: "eq", value: "demo-client-021" }] },
  client21Matters: { ...allMatters, filters: [...fixtureFilters, { field: "properties.client_id", op: "eq", value: "demo-client-021" }] },
} satisfies Record<string, WikiDataQuery>;

const bindings = (names: string[]) => names.map(name => `${name} = Query("wiki_query", {name:"${name}"}, {rows:[],total:0})`).join("\n");
const makeView = (title: string, mode: ViewInput["mode"], queries: ViewInput["queries"], body: string): ViewInput => ViewInputSchema.parse({ version: 1, title, mode, catalog: "legalwork-1", queries, program: `${bindings(Object.keys(queries))}\nroot = ${body}`, fallbackMarkdown: `Synthetic demo fixture: ${DEMO_FIXTURE}. Reference date ${DEMO_AS_OF}. ${title}.` });

/** Query actual indexed pages when materializing, so report revisions cite the seeded source bytes. */
export function buildDemoViews(pages: WikiPage[], wikiId: string): DemoView[] {
  const portfolio = makeView("Demo · Client portfolio", "dashboard", { clients: DEMO_QUERIES.clients, matters: DEMO_QUERIES.matters, money: DEMO_QUERIES.money, stage: DEMO_QUERIES.stage, practice: DEMO_QUERIES.practice },
    'Stack([Heading("Client portfolio",1),Text("Synthetic law firm · EUR · reference date 11 October 2026"),Stack([Metric("Clients",clients.total),Metric("Matters",matters.total),Metric("Recorded fees",money.rows[0].fees,"EUR, simulated")],3),Card("Engagement stages",[Board(clients.rows,"properties.engagement_stage","title",[{field:"properties.partner",label:"Partner"},{field:"properties.fees_eur",label:"Fees EUR"}],["Prospect","Onboarding","Active","Retainer","Dormant"]) ]),Stack([Card("Clients by stage",[BarChart(stage.rows,"properties.engagement_stage",["clients"])]),Card("Budget and fees by practice",[BarChart(practice.rows,"properties.practice",["budget","fees"])])],2)])');
  const matters = makeView("Demo · Matter control", "dashboard", { open: DEMO_QUERIES.open, overdue: DEMO_QUERIES.overdue, upcoming: DEMO_QUERIES.upcoming, overBudget: DEMO_QUERIES.overBudget, partners: DEMO_QUERIES.partners },
    'Stack([Heading("Matter control",1),Callout("Internal demo targets","Due-window labels are relative to 11 October 2026, not statutory deadlines.","info"),Stack([Metric("Open matters",open.total),Metric("Overdue targets",overdue.total),Metric("Over-budget matters",overBudget.total)],3),Card("Open workload by partner",[BarChart(partners.rows,"properties.partner",["open_matters"])]),Card("Overdue internal targets",[Table(overdue.rows,[{field:"title",label:"Matter"},{field:"properties.partner",label:"Partner"},{field:"properties.internal_due",label:"Internal target"},{field:"properties.stage",label:"Stage"}])]),Card("Next seven days",[Table(upcoming.rows,[{field:"title",label:"Matter"},{field:"properties.internal_due",label:"Target"},{field:"properties.partner",label:"Partner"}])]),Card("Budget exceptions",[Table(overBudget.rows,[{field:"title",label:"Matter"},{field:"properties.budget_eur",label:"Budget EUR"},{field:"properties.fees_eur",label:"Fees EUR"}])])])');
  const knowledge = makeView("Demo · Knowledge library", "dashboard", { processes: DEMO_QUERIES.processes, templates: DEMO_QUERIES.templates, reviewDue: DEMO_QUERIES.reviewDue },
    'Stack([Heading("Knowledge library",1),Text("Synthetic operational examples, not legal advice or approved firm policies."),Stack([Metric("Processes",processes.total),Metric("Templates",templates.total),Metric("Reviews due",reviewDue.total)],3),Card("Operational processes",[Table(processes.rows,[{field:"title",label:"Process"},{field:"properties.owner",label:"Owner"},{field:"properties.status",label:"Review status"},{field:"properties.next_review",label:"Review date"}])]),Card("Word templates and wiki guides",[Table(templates.rows,[{field:"title",label:"Template"},{field:"properties.owner",label:"Owner"},{field:"properties.document",label:"Adjacent document"}])]),Source("Templates/Engagement-letter.md","Open the engagement template guide")])');
  const reportQueries = { client: DEMO_QUERIES.client21, matters: DEMO_QUERIES.client21Matters };
  const report = makeView("Demo · C021 client briefing snapshot", "report", reportQueries,
    'Stack([Heading("Demo Alder Studio · client briefing",1),Callout("Frozen synthetic report","This project-owned report captures wiki data at creation. Source pages remain in the wiki.","info"),Metric("Matters",matters.total),Card("Client relationship",[Table(client.rows,[{field:"title",label:"Client"},{field:"properties.engagement_stage",label:"Engagement"},{field:"properties.partner",label:"Relationship partner"},{field:"properties.fees_eur",label:"Fees EUR"}])]),Card("Matter snapshot",[Table(matters.rows,[{field:"title",label:"Matter"},{field:"properties.stage",label:"Stage"},{field:"properties.internal_due",label:"Internal target"},{field:"properties.budget_eur",label:"Budget EUR"},{field:"properties.fees_eur",label:"Fees EUR"}])]),Source("Clients/C021.md","Open the source client page","client")])');
  report.datasets = Object.fromEntries(Object.entries(reportQueries).map(([name, query]) => [name, { ...queryWikiPages(pages, query), sourceOwner: { kind: "wiki", id: wikiId } }]));
  report.queries = {};
  return [
    { key: "portfolio", scope: "wiki", referencePath: "Dashboards/Client-portfolio.md", input: portfolio },
    { key: "matters", scope: "wiki", referencePath: "Dashboards/Matter-control.md", input: matters },
    { key: "knowledge", scope: "wiki", referencePath: "Dashboards/Knowledge-library.md", input: knowledge },
    { key: "briefing", scope: "project", referencePath: "Reports/Client-C021-briefing.md", input: ViewInputSchema.parse(report) },
  ];
}
export function buildDemoWikiReport(pages: WikiPage[], wikiId: string): DemoView {
  const report = buildDemoViews(pages, wikiId).find(view => view.scope === "project");
  if (!report) throw new Error("Missing demo briefing");
  return { ...report, key: "wiki-briefing", scope: "wiki", referencePath: "Reports/Client-C021-briefing.md", input: { ...report.input,
    title: "Demo · Wiki client briefing snapshot",
    program: report.input.program.replace("This project-owned report captures wiki data at creation. Source pages remain in the wiki.", "This wiki report captures the indexed source data at creation and remains a frozen snapshot."),
    datasets: Object.fromEntries(Object.entries(report.input.datasets ?? {}).map(([name, { sourceOwner: _sourceOwner, ...dataset }]) => [name, dataset])),
  } };
}
export function demoViewReference(view: DemoView, saved: Pick<ViewRecord, "id" | "owner">): DemoFile {
  const reference = `${saved.owner.kind}:${encodeURIComponent(saved.owner.id)}/${saved.id}`;
  return page(view.referencePath, { id: `demo-view-${view.key}`, type: "page", title: view.input.title }, `# ${view.input.title}\n\nSynthetic demo data. Reference date ${DEMO_AS_OF}. ${view.input.mode === "dashboard" ? "This view reads its indexed wiki fields live." : "This report keeps the data captured when it was created."}\n\n\`\`\`legalwork-view\n${reference}\n\`\`\`\n\n[Open in its own tab](legalwork-view://${saved.owner.kind}/${encodeURIComponent(saved.owner.id)}/${saved.id})`);
}

export type DemoFileTarget = { read(path: string): Promise<string | null>; create(path: string, content: string): Promise<void> };
/** The target must enforce create-only semantics atomically (API baseRevision="" or filesystem wx). */
export async function seedDemoFiles(target: DemoFileTarget, files: DemoFile[]) {
  const result: { created: string[]; unchanged: string[]; preserved: string[] } = { created: [], unchanged: [], preserved: [] };
  for (const file of files) {
    const current = await target.read(file.path);
    if (current !== null) { (current === file.content ? result.unchanged : result.preserved).push(file.path); continue; }
    await target.create(file.path, file.content);
    result.created.push(file.path);
  }
  return result;
}
export type DemoViewTarget = { owner: ViewOwner; list(): Promise<{ items: { id: string; title: string }[]; issues: unknown[] }>; read(id: string): Promise<ViewRecord>; create(input: ViewInput): Promise<ViewRecord> };
/** Reuse this fixture's saved record, preserve all existing edits/snapshots, and reject ambiguous title collisions. */
export async function seedDemoViews(target: DemoViewTarget, views: DemoView[]) {
  const existing = await target.list(), records: { view: DemoView; saved: ViewRecord; created: boolean }[] = [];
  if (existing.issues.length) throw new Error("Resolve saved-view issues before seeding demo views.");
  for (const view of views) {
    if ((view.scope === "wiki") !== (target.owner.kind === "wiki")) throw new Error("The demo view must be saved in its intended wiki or project.");
    const matches = existing.items.filter(item => item.title === view.input.title);
    if (matches.length > 1) throw new Error(`Multiple saved views already use ${view.input.title}`);
    if (matches.length) {
      const saved = await target.read(matches[0].id);
      if (!saved.fallbackMarkdown?.includes(`Synthetic demo fixture: ${DEMO_FIXTURE}.`)) throw new Error(`Preserving a non-demo view named ${view.input.title}`);
      records.push({ view, saved, created: false });
    } else records.push({ view, saved: await target.create(view.input), created: true });
  }
  return records;
}
