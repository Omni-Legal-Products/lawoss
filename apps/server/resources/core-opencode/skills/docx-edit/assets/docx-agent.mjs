#!/usr/bin/env node
/**
 * docx-agent — headless Word reading + editing for the firm's agent.
 *
 * Self-contained: it imports the vendored ./vendor/docx-engine.mjs (an esbuild
 * bundle of @eigenpal/docx-editor-agents, Apache-2.0 — the same engine behind the
 * in-app .docx viewer), so it runs in any seeded workspace with NO node_modules.
 *
 * Subcommands:
 *
 *   inspect <file.docx>
 *       Print the document as JSON. `paragraphs` are the TOP-LEVEL body paragraphs
 *       (each with a 0-based `index` you can edit by). `tables` is the text of every
 *       table (rows × cells) so you can READ clauses laid out in tables. `changes`
 *       and `comments` summarize existing tracked changes / comments.
 *
 *   apply <file.docx> --plan <plan.json | -> [--out <file>] [--in-place] [--author "Name"]
 *       Apply an edit plan and write the result (default "<base>.redlined.docx").
 *       Plan: { comments:[{paragraphIndex,text,search?}],
 *               proposals:[{paragraphIndex,search,replaceWith}],
 *               accept:[changeId...], reject:[changeId...] }
 *
 *   accept-all / reject-all <file.docx> [--out <file>] [--in-place]
 *       Accept (adopt) or reject ALL tracked changes, then write the clean result.
 *
 * IMPORTANT capability note: comment/redline edits (`apply`) address only TOP-LEVEL
 * paragraphs by index. Many legal contracts lay every clause inside a table; the
 * headless engine can READ that table text (see `tables`) and accept/reject changes
 * document-wide, but it cannot redline a clause that lives inside a table — open the
 * document in the in-app viewer to edit those clauses directly. `inspect` flags this.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { DocxReviewer } = await import(pathToFileURL(join(HERE, "vendor", "docx-engine.mjs")).href);

// ---------- args ----------

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else { flags[key] = next; i += 1; }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function fail(message) {
  process.stderr.write(`docx-agent: ${message}\n`);
  process.exit(1);
}

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

async function load(file, author) {
  const path = resolve(file);
  if (!existsSync(path)) fail(`file not found: ${file}`);
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { path, reviewer: await DocxReviewer.fromBuffer(buffer, author) };
}

// Output filenames must be PLAIN (no spaces, parens, etc.) so the app's artifact
// pipeline surfaces them as openable .docx artifacts — exactly the way it already
// surfaces .md/.csv/.html. A spaced/paren name (common for legal files) silently
// fails the filename matcher and never appears as something the user can open.
function plainName(name) {
  return name.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "document";
}

function defaultOut(source, flags) {
  if (typeof flags.out === "string") return resolve(flags.out);
  if (flags["in-place"]) return source;
  const ext = extname(source);
  return join(dirname(source), `${plainName(basename(source, ext))}.redlined${ext || ".docx"}`);
}

async function writeOut(reviewer, outPath) {
  const buf = await reviewer.toBuffer();
  writeFileSync(outPath, Buffer.from(buf));
}

// ---------- commands ----------

// The library's canonical edit index space: getContentAsText enumerates EVERY
// paragraph in document order — body paragraphs AND table cells — and
// addComment/replace/applyReview's `paragraphIndex` use that same 0-based ordinal
// (confirmed in the engine docs). So we enumerate the same way: one entry per
// paragraph, `index` = its ordinal. Table cells carry a `location` like
// "table, row 43, col 4". Editing a clause inside a table works — anchor by `index`
// and a verbatim `search`. (A wrong index can't silently edit the wrong clause: the
// verbatim `search` won't match, so applyReview reports it in `errors` instead.)
function enumerateParagraphs(reviewer) {
  const paragraphs = [];
  // Marker = "[<paraId-or-number>]" optionally followed by "(table, row R, col C)".
  const markerRe = /^\[[0-9A-Za-z]+\]\s?(?:\((table, row \d+, col \d+)\)\s?)?(.*)$/;
  for (const line of reviewer.getContentAsText().split("\n")) {
    const m = markerRe.exec(line);
    if (m) paragraphs.push({ index: paragraphs.length, location: m[1] ?? "body", text: m[2] ?? "" });
    else if (paragraphs.length) paragraphs[paragraphs.length - 1].text += "\n" + line; // multi-line cell
  }
  return paragraphs;
}

async function cmdInspect(positional) {
  const file = positional[0];
  if (!file) fail("usage: inspect <file.docx>");
  const { reviewer } = await load(file, "Inspector");

  const paragraphs = enumerateParagraphs(reviewer);

  process.stdout.write(JSON.stringify({
    file,
    totalParagraphs: paragraphs.length,
    tableCells: paragraphs.filter((p) => p.location !== "body").length,
    // Edit by anchoring to a paragraph's `index` + a verbatim `search` from its `text`.
    paragraphs,
    // Pre-existing markup — relevant ONLY for accept/adopt/reject requests, NOT for editing.
    existingTrackedChanges: reviewer.getChanges().map((c) => ({ id: c.id, type: c.type, author: c.author, text: c.text })),
    existingComments: reviewer.getComments().map((c) => ({ id: c.id, author: c.author, text: c.text })),
  }, null, 2) + "\n");
}

async function cmdApply(positional, flags) {
  const file = positional[0];
  if (!file) fail("usage: apply <file.docx> --plan <plan.json|-> [--out <file>] [--in-place] [--author NAME]");

  const planRaw = flags.plan === "-" || flags.plan === true
    ? readStdin()
    : readFileSync(resolve(String(flags.plan ?? "")), "utf8");
  let plan;
  try { plan = JSON.parse(planRaw); }
  catch (error) { fail(`could not parse --plan JSON: ${error instanceof Error ? error.message : String(error)}`); }

  const author = typeof flags.author === "string" ? flags.author : plan.author ?? "Eigenwelt Reviewer";
  const { path: source, reviewer } = await load(file, author);

  const result = reviewer.applyReview({
    comments: Array.isArray(plan.comments) ? plan.comments : undefined,
    proposals: Array.isArray(plan.proposals) ? plan.proposals : undefined,
    accept: Array.isArray(plan.accept) ? plan.accept : undefined,
    reject: Array.isArray(plan.reject) ? plan.reject : undefined,
  });

  const outPath = defaultOut(source, flags);
  await writeOut(reviewer, outPath);

  process.stdout.write(JSON.stringify({
    ok: (result.errors?.length ?? 0) === 0,
    out: outPath,
    name: basename(outPath),
    commentsAdded: result.commentsAdded ?? 0,
    proposalsAdded: result.proposalsAdded ?? 0,
    accepted: result.accepted ?? 0,
    rejected: result.rejected ?? 0,
    errors: result.errors ?? [],
    totalChanges: reviewer.getChanges().length,
    totalComments: reviewer.getComments().length,
  }, null, 2) + "\n");
}

async function cmdResolveAll(mode, positional, flags) {
  const file = positional[0];
  if (!file) fail(`usage: ${mode}-all <file.docx> [--out <file>] [--in-place]`);
  const { path: source, reviewer } = await load(file, "Eigenwelt Reviewer");
  const before = reviewer.getChanges().length;
  if (mode === "accept") reviewer.acceptAll();
  else reviewer.rejectAll();
  const outPath = defaultOut(source, flags);
  await writeOut(reviewer, outPath);
  process.stdout.write(JSON.stringify({
    ok: true, mode, out: outPath, name: basename(outPath), changesResolved: before, remainingChanges: reviewer.getChanges().length,
  }, null, 2) + "\n");
}

// ---------- main ----------

const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional.shift();

if (command === "inspect") await cmdInspect(positional);
else if (command === "apply") await cmdApply(positional, flags);
else if (command === "accept-all") await cmdResolveAll("accept", positional, flags);
else if (command === "reject-all") await cmdResolveAll("reject", positional, flags);
else fail(`unknown command "${command ?? ""}". Use inspect | apply | accept-all | reject-all.`);
