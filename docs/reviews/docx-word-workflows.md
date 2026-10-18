# Word workflows validation — 12 October 2026

Implemented in the production `ArtifactDocxEditor` on `dev`; the Electron check
used that component through `docx-review.html?fixture=word` on Vite port 5420.
The test instance used isolated application data and workspace recovery was
disabled. The user's demo project and original Word file were not modified.

| Workflow | Result |
| --- | --- |
| Update contents and fields | Rebuild existing TOCs; resolve REF/PAGEREF, PAGE/NUMPAGES, SECTION/SECTIONPAGES, SEQ and supported STYLEREF forms. Preserve native instructions and bookmark targets through saving. |
| Compare and combine | Separate editable native redline copy; word changes inside content controls, paragraphs, table rows, formatting, headers and notes. Independent proposals retain reviewer authors. Whole-document accept/reject and DOCX download. |
| Section page numbering | Roman front matter, Arabic restart and continuation; restored to native Word section settings on save and export. |
| Outline | Enabled native heading navigation and reserved its space when fitting pages. |
| Template protection | Fill unlocked controls while fixed text is blocked; honor control locks; require native suggestions and prevent switching tracking off. Native document protection is saved. |
| Outgoing inspection | Counts metadata, hidden text including style inheritance, custom XML, comments/replies, revisions and external relationships. Selected removals affect a downloaded copy. External links are reported. |
| Reference navigation | Click/Enter on rendered references; double-click footnote markers and note numbers for navigation in both directions. |

## Automated checks

42 tests passed across `docx-word-workflows`, `docx-roundtrip`,
`docx-document-state`, `docx-history-performance` and
`docx-measurement-performance`. App type checking, the production build and
the en/de translation check passed. `git diff --check` passed.

Regression checks cover renumbering after clause insertion, broken targets,
section restart, content-control protection, native tracked edits, accepted and
rejected comparison text and formatting, structural changes, multiple authors,
comment identities, inherited hidden text, and clean export without changing
the source. Tests also reproduce Word's disposal of TOC bookmarks and ensure
the contract's REF targets survive it.

## Computer-use checks

In the actual Electron desktop shell, verified field updates; heading jumps;
footnote navigation; filling a template control while boilerplate typing was
blocked; saved protection and values after reopening; forced Suggesting mode
after selecting Editing; and a typed native tracked insertion. Opened the full
contract comparison, navigated to its rent redline, accepted proposals in the
separate preview, and downloaded a redline copy. The outgoing inspector exported
a copy with its selected metadata, comments and revisions removed.
Also selected two returned drafts in the native picker and used Combine:
the preview retained `aa-counsel`'s rent change from 48 to 60 and `bb-counsel`'s
insurance change from 5 to 6 as separate native insertions/deletions.

The final clean copy was generated through the Electron UI, then opened through
Finder in Microsoft Word. Selected Word's field-update prompt. Word opened it
without a repair prompt and rebuilt fields without reference-source errors;
Rückbau resolved to **8**, both footnotes remained native Word footnotes, and
multilevel numbering rendered as **3.5 / 3.6 / 4 / 4.1**. The file retained Roman
front matter and the Arabic section restart, 13 PAGEREF instructions and 31
bookmarks (18 contract targets and 13 dedicated TOC targets). Reinspection found
none of the selected private-data categories.

Word testing exposed and prompted fixes for two issues missed by the initial
editor tests: Word misreads interleaved numbering definitions, and updating a
TOC removes its old bookmarks. Exports now order numbering correctly and use
separate TOC bookmarks. Also fixed the pinned core/agents packages dropping
tracked changes inside inline template controls.

## Limits

- This is not a claim of complete Word parity. Word is unactivated on this
  machine, so opening, rendering and field refresh were tested; editing,
  protection and Word's own Compare/Combine commands could not be exercised.
- Conflicting proposals and changes to table column structure require separate
  review; the combiner reports them instead of silently merging alternatives.
- Comparison can include generated field-cache and direct-formatting changes
  when comparing an editor-saved document with an untouched Word template.
- Unsupported field types/switches retain cached results. NOTEREF, a complete
  Word formula engine and relative-context numbering are not implemented.
- Footnote text is rendered rather than editable in place; this change adds
  navigation and preserves native notes on export.
- Existing password protection is retained; unlocking it requires Word. This
  change does not add password creation or all Word permission-range modes.
- The native page-position badge can be inaccurate at reduced zoom; contextual
  PAGE fields and exported section numbering are verified separately.

Word behavior references:
[fields](https://support.microsoft.com/en-au/word/update-fields),
[legal blackline](https://support.microsoft.com/en-gb/word/compare-document-differences-using-the-legal-blackline-option),
[content controls](https://support.microsoft.com/en-us/word/about-content-controls).

## Agent tools — 13 October 2026

Live document reads now return text and a native Word structure snapshot. The
snapshot identifies field instructions, display/resolved values, target bookmarks,
broken references, automatic heading numbers, content controls/locks, linked notes,
section numbering and protection. It includes fields in headers, footers and notes,
including stories that have not yet been opened in the UI. Document contents and
metadata remain source material rather than instructions.

The agent can create paragraph or exact-text range bookmarks; insert or retarget linked
REF/PAGEREF fields; fill native text controls; edit and insert linked footnotes or
endnotes; refresh fields/contents; apply heading styles and section breaks; and set
section numbering or unpassworded protection. Structural tools require the
current document instance and revision, reject stale reads and honor protection.
Read-only editors still allow inspection. A save failure explicitly retains the
applied draft, and the save_document operation retries persistence without repeating the edit.

Inspection, cleaned outgoing copies and Compare/Combine are also exposed as agent
tools. Copy tools use the live draft, preserve the source, write a new workspace
DOCX with no overwrite, constrain returned drafts to the workspace (including
symlink checks), and return a file path rather than binary data to the model.
Removing revisions in a cleaned copy accepts all its pending edits; the categories
are explicit in the tool arguments and descriptions.

Validation: **51 editor tests and 22 agent bridge tests passed**. App/server type
checks and production builds passed; the en/de translation and diff checks passed.
Tests cover native field/bookmark/note save/reopen, renumbering, missing targets,
ambiguous edits, template protection, live note-marker insertion before model
reload, and reference resolution across stories. Server tests cover routing,
identity schemas, copy output, no overwrite and symlink escape rejection.

In the isolated Electron dev app, computer use invoked the production agent API:
created a reference to Rückbau, retargeted it to Vergütung, rejected a stale repeat,
filled a protected text control while a boilerplate edit was rejected, edited note
1 and created linked note 3, changed front-matter numbering to uppercase Roman,
updated fields and saved. Reopening retained native REF Verguetung with the w/h
switches, resolved number **4**, three footnotes including the linked new note,
the edited note text, template value and numbering. This caught a React-adapter
issue where saving could overwrite a newly loaded model body with its previous
live view; committing the note marker in the live view before loading note
metadata fixed it. A regression test covers that order.

Electron checks also created a separate clean copy with no selected comments or
revisions and a comparison with four native changes attributed to Agent QA
Counsel; the source revision remained unchanged. Read-only mode permitted
structure reads and rejected mutations. A simulated failed save left the draft
dirty; recovering that synthetic draft and calling the new save-retry tool saved
it, and another reopen retained the reference, linked note and values.

The six unused Word QA document windows and Word's start window were closed;
Microsoft Word is no longer running. The user's demo document was not changed.

Limits: structural/control/note operations are direct edits, not tracked proposals;
mandatory tracked-change protection blocks them. Bookmarks can cover paragraphs
or exact text ranges, and field editing targets body REF/PAGEREF fields. Other stories' fields
are visible to the agent; unsupported field kinds keep cached results. Only plain
text controls can be filled; bound/locked/typed or complex controls are rejected.
Note edits preserve other content but reload the model, resetting native undo
history; unsupported verbatim note XML is preserved and rejected for editing.
Full Word parity is not claimed. Restart the development app/worker to load the
new agent tool schemas; running workers retain their previously registered tools.

Word cross-reference semantics were checked against [Microsoft's documentation](https://support.microsoft.com/en-us/word/create-a-cross-reference).


## Agent tool surface after merging dev — 14 October 2026

Merged `origin/dev` (`8255eba9`) into `feat/word-editor-agent` first, in merge
commit `d88842cc`. Preserved dev's task/project document routing, persistent
background editors, per-document queues, editing ownership, autosave and safe
file handoffs. Combined both branches' pinned SDK patches rather than replacing
one set of fixes. Fixed instructions remain in the system prompt; current document
state stays in dev's conversation reminders.

The public API retains dev's twelve tools and adds **three** tools:

| Tool | Responsibility |
| --- | --- |
| `inapp_docx_read_document` | Whole-document live text, structure and formatting reads by default; optional `view`, `paraId`, `fromIndex`, `toIndex`, `limit`, `includeStyles`; explicit coverage and `nextIndex` for pagination. |
| `inapp_docx_fill_template` | Existing clean placeholder replacement plus native text controls by ID or unique tag, with lock/protection checks. |
| `inapp_docx_edit` | Typed sequential native edit batches, one final save; formatting/styles, bookmarks/references, notes, breaks, numbering, protection and field refresh. `action: "save"` retries persistence without repeating edits. |
| `inapp_docx_compare_documents` | Compare/combine saved returned project drafts with the live draft into a separate native redline copy. |
| `inapp_docx_inspect_document` | Inspect privacy findings, optionally create an outgoing copy with explicit removal categories. |

The existing selection/search, suggestions, comments/replies, targeted change
review and explicit file handoff tools remain separate. There are **15 public
in-app Word tools in total**. No generic `inapp_docx` tool or dynamic help API is
registered. Shared schemas validate the entire native batch before editing. A
semantic failure stops subsequent operations, saves any earlier edits and reports
`appliedOperations`, `failedIndex` and persistence errors. Batches are sequential,
not atomic; the agent must re-read rather than replay applied edits. Autosave is
suspended while a native batch runs.

Comparison and outgoing copies use the originating project's existing file API,
including remote project servers and their permission/approval checks. Binary
writes support `createOnly`, checked inside the file lock; racing creators and
existing destinations cannot overwrite another copy. Read/copy operations do not
require editing ownership of the source; new copies still require project write
access. Raw DOCX/base64 is removed from the public result.

Native Electron computer-use checks against the production editor and synthetic
contract passed:

- A single batch creates a bookmark and linked REF field, then changes title
  font/emphasis/size, alignment, spacing, indent and keep flags; readback and
  save/reopen retain the native field and formatting.
- A deliberately failing second operation retains/saves the first and does not
  apply the third. The result reports partial success accurately.
- A simulated save failure preserves applied edits and recovery; save-only retry
  persists the draft without repeating operations.
- Native control filling under form protection, boilerplate/stale-edit rejection,
  reference retargeting, note editing/insertion, backlink preservation, Roman
  numbering and field refresh all survive save/reopen.
- Clean copies remove the selected comments/revisions, comparison changes keep
  their reviewer author, and the source remains unchanged.
- Read-only mode permits formatting reads and rejects native edit batches.

Validation: 100 editor/runtime tests, 52 server/routing/file tests, app/server
TypeScript checks, app/server production builds, and the shipped en/de i18n audit.
Electron screenshots: [native save/reopen](word-tools-dev-merge/native-reopen.png)
and [read-only formatting checks](word-tools-dev-merge/read-only.png).

The existing Word fidelity limits documented above still apply; this change does
not claim full Word parity. The user's original demo document stays unchanged.

## Agent formatting — 13 October 2026

Formatting reads and native edits are now exposed through
`inapp_docx_read_document` (`view: "formatting"`) and typed `apply_formatting`
operations in `inapp_docx_edit`. Default reads include formatting for the whole document,
and structure reads
include paragraph/style handles and formatting capabilities. Focused/paginated
reads expose run marks, fonts/sizes, emphasis, colors, character styles, paragraph
alignment, spacing/indents and pagination flags. Optional style definitions include
inheritance and explicit OOXML units.

Character edits target a paragraph or exact unique phrase; paragraph properties
apply to the whole paragraph. Values use points, with automatic line spacing as a
multiple. Existing named styles remain available through `set_paragraph_style`.
Formatting is direct/untracked, requires fresh document/revision identity and
enforces document/control protection; pending text revisions are rejected.
Formatting an already-applied value succeeds without duplicating edits.

Save/reopen testing exposed two adapter gaps: inherited emphasis returned after
removing its mark, and paragraph spacing/keep properties retained their old native
values. Formatting edits now update the preserved paragraph properties and saves
write explicit negative run overrides where styles would otherwise restore them.
The save correction keeps the SDK's injected reply anchors and review markup.
Electron testing also caught React publishing a new document handle during the
save; native updates now flush synchronously through dev’s React save integration
before serialization.

Verified through native computer use in the isolated Electron 43.7.5 development
app against the production editor and synthetic Word fixture: Arial/bold title to
Times New Roman, 18 points, italic/nonbold, right alignment, 12-point spacing,
24-point indent and keep flags. Agent readback after save/reopen matched all those
values. Stale edits were blocked; repeat edits succeeded; read-only mode still
allowed formatting reads and blocked writes. Only the QA app/server were launched.

Formatting regression coverage includes native DOCX overrides and spacing units,
phrase-only editing, unchanged text/references, comment/reply anchors and revisions,
invalid input, protection/locks and paginated read visibility. App/server typechecks
and builds passed, as did 56 relevant editor tests and 31 routing/schema tests.

Current scope: body paragraphs, including text within tables/controls. Table
geometry/borders and header/footer/note formatting are not exposed for editing.
Full Word formatting parity is not claimed. Restart the development worker/app to
load the newly available operation schemas.

## Reference fixes from the two-paragraph session (15 October 2026)

The plain-text reader now includes cached field results. Text search keeps native
fields and bookmark boundaries out of replacement ranges, so visible field text
cannot be mistaken for editable document characters. Pending insertions retain
existing vanilla-read semantics.

Long cached field results use the text layout engine, with every wrapped fragment
mapped to the original atomic field position. Painting adds links to all fragments
without replacing each fragment with the entire field result. Clicking a reference
navigates to the native bookmark start.

`create_bookmark.search` and `insert_cross_reference.targetSearch` select an exact
unique phrase for the bookmark. Native inline bookends preserve imported ranges,
including ranges spanning paragraphs; typing, splits and undo move them with the
content. The serializer emits actual OOXML start/end boundaries and preserves
formatting. Paragraph bookmarks remain supported. Manually typed § labels use
`kind: "text"` with a short target search; `kind: "number"` requires native numbering.

The public surface remains fifteen tools. Operation discriminators use single-value
enums in the model JSON schema, the edit description lists accepted names, and
validation errors identify the bad operation and the correct syntax. Fixed guidance
requires fresh identity/handles on each new user request, native field readback, and
an actual preview before diagnosing visibility. Duplicate unlinked text workarounds
are explicitly discouraged.

Validation: 77 app/editor tests across twelve files; 33 server tool/routing tests;
app and server typechecks and production builds; clean frozen-lockfile installation;
CommonJS native bookmark/field/flow smoke test. Electron computer use exercised the
production editor with a minimal two-paragraph fixture: full and short references,
three wrapped fragments with no clipping, save, reopen, native range readback,
plain-text field readback, click navigation to § 2, and caret placement after the
final line of a wrapped native field. The QA BrowserWindow disables
background throttling so renderer readiness completes while Codex is foreground.
Evidence: [reopened screenshot](word-reference-fixes/reopened.png) and
[accessibility readback](word-reference-fixes/reopened-ax.txt).

The original session's DOCX and recovered draft were not edited by these tests.
The main Electron dev runtime was restarted on port 5481 to load the rebuilt tool
plugin and updated SDK. Temporary diagnostic logs and the guessed save-status fix
were removed: a test fixture's orphaned comment, rather than a production save
failure, caused that warning.

Update fields shares one document-tools bar with Review changes, Accept all changes and Reject all changes. The commands wrap together on narrow panes and retain their existing disabled/protection rules; no separate fields row remains.

## Whole-document read compatibility — 15 October 2026

Restored whole-document reads by default for text, structure and formatting.
Pagination is optional; explicit ranges no longer have the added 50-paragraph cap.
A 75-paragraph regression fixture verifies complete default reads, remaining reads,
large explicit ranges, optional pagination and focused paragraph reads. Updated
tool schemas, descriptions and bundled agent instructions consistently.

Validation: `pnpm exec bun test` on the twelve editor suites above passed 78 tests;
`pnpm exec bun test src/opencode-plugins/legalwork-extensions-preview.test.ts`
passed 34 server tests. App and server `pnpm typecheck` passed.
