# Local file-memory acceptance pilot

This runner exercises the actual source CLI and exported native `createHandoff` against an explicit local corpus. It copies only the profile-listed, successfully loaded source texts into a fresh private run before any SAVE. Existing input workspaces, cards, notes and logs remain read-only.

Specification: [existing office/case memory](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/06aba22/specs/2026-09-21-riha-memory-parity.md).

## Run

Use Node 24 from `lawoss/okf-pamat`:

```sh
node scripts/workspace-memory-pilot.ts --manifest /absolute/local/pilot-manifest.json
# Optional existing directory outside Git:
node scripts/workspace-memory-pilot.ts --manifest /absolute/local/pilot-manifest.json --output-root /absolute/local/private-runs
node --test tests/workspace-memory-pilot.test.ts
pnpm typecheck
```

The default output is a unique directory below the physical system temporary directory. On macOS, input paths must satisfy the reader's physical-path checks (for example, use `/private/tmp` instead of its `/tmp` alias). The runner rejects output within Git, an input workspace or a granted input root. It performs only a read-only Git destination check; it does not commit, publish, invoke a model or contact a registry.

Exit 0 means every case/probe passed. Exit 1 means failure; completed runs and full subprocess/native evidence remain available. The terminal prints generic case IDs, counts and the report location. Full error bodies and source content are stored only in the private run. Invalid arguments or an unusable manifest/output location produce a generic error before a run starts.

## Manifest

The manifest is version 1 with `cases: [{id, workspace, allowedRoots, expectations}]`. Paths must be absolute. Use generic IDs consisting of letters, digits, underscores or hyphens; never put a client name or identifier in an ID. Each expectation has `sourceId`, the exact lowercase SHA-256 of its input file, and an `includes` array of exact text fragments. Cover every profile-listed source exactly once. An optional `classification` key is accepted and does not change access rights or processing.

Illustrative synthetic shape below; replace the hash placeholders with independently recorded SHA-256 values and provide an expectation for every source:

```json
{
  "version": 1,
  "cases": [{
    "id": "case-01",
    "classification": "synthetic",
    "workspace": "/absolute/synthetic/workspace",
    "allowedRoots": ["/absolute/synthetic/vault"],
    "expectations": [
      {"sourceId": "memory", "sha256": "<64 lowercase hex characters>", "includes": ["SYNTHETIC-01"]},
      {"sourceId": "card", "sha256": "<64 lowercase hex characters>", "includes": ["original_date: 2020-01-02"]},
      {"sourceId": "note", "sha256": "<64 lowercase hex characters>", "includes": ["[[original-link]]"]},
      {"sourceId": "log", "sha256": "<64 lowercase hex characters>", "includes": ["Pending work"]}
    ]
  }]
}
```

Each workspace must have a valid `.lawoss/memory-profile.json` (see [README](README.md)). This acceptance scenario requires all four writable roles: `case_memory`, `case_card`, `work_note`, `task_log`. Every listed source, including optional ones, must be loaded for this pilot. Read-only rules, lessons, source indexes, raw JSON or other UTF-8 evidence may also be listed. The runner never follows references in those files or recursively copies the original roots. It maps the original named roots into separate `copies/root0`, `root1`, etc., creates control metadata under `copies/workspace`, and explicitly grants those copied roots. Single-root input profiles therefore exercise external-root authority too.

## What is checked

- Actual CLI reads and rendering contain all expected source IDs, full bodies, exact hashes and distinct physical files. Source dates, warnings, links and repeated rows survive byte-preserving copies.
- Wrong matter ID and withheld copied-root grants fail. The first native checkpoint contains the complete source bodies and revisions.
- SAVE appends one generic dated, test-only annotation to every writable source, preserving each entire old text as a prefix. Preview creates no files or transaction state. Apply commits the full set; replay is idempotent; operation-ID reuse with different content and stale-context writes are rejected without mutation.
- Fresh CLI reads show updated revisions, unchanged read-only sources and exactly one appended annotation per writable source. Full old hashes are present in history snapshots. Inventories reject extra cards and projections, including newly generated typed `memory/` or `_STATUS.md` files; an existing profiled `_STATUS.md` is preserved.
- A fresh native factory and session read the saved context. Removing a required copied source causes an incomplete read and failed checkpoint while retaining the last good artifact. Only that copied source is restored afterward.
- The `finally` check compares input profile and all loaded original source hashes even when a probe fails. If a complete original snapshot could not be obtained, `originalsUnchanged` is false rather than claiming full verification.

Each run retains `report.json`, per-case results, original hash comparisons, source copies, SAVE requests, raw CLI stdout/stderr and process metadata, native results, and generated snapshots/checkpoints. Directories are created with mode 0700 and files with mode 0600. Runs are intentionally not deleted on success or failure; handle retention through the user's local data policy. Do not attach these private artifacts to a public issue or PR.

## Coverage boundaries

The JSON report explicitly marks `legal_review` and `gui` as `NOT_RUN`. This is a local file-context persistence test: it does not independently verify registry identity, legal facts, source freshness, signature, delivery or filing. Raw JSON is preserved as text without domain schema validation; repeated events and incomplete-page indicators are retained rather than deduplicated or interpreted. Registry retrieval and PDF extraction are separate preparation checks.

The reader limits are 2 MiB per source and 16 MiB total. Native rendered context is bounded at 2 MiB; failures retain the previous checkpoint instead of certifying truncated context. Native hooks have a separate 64 KiB inline threshold. This runner exercises exported native checkpoint persistence, not GUI lifecycle integration or inline model injection. Hostile concurrent filesystem replacement and crash-atomic transactions across roots are not claimed.

The synthetic regression covers a two-root case with all four writable roles, read-only rules, and raw JSON containing repeated events and an explicit incomplete flag. It also proves that an expectation failure returns nonzero, retains diagnostics, verifies originals and continues a subsequent case; output-location guards are tested independently.

## Recorded local acceptance

On 2026-09-21, Node 24.21.0 executed the runner against two prepared public insolvency corpora and one isolated copy of an existing private matter, using the corrected CLI at `f67acb83bbf4c3a9b7c55e30cdd5ffd8ea7195cd`:

| Check | Result |
|---|---|
| CLI/native cases | 3 passed / 0 failed |
| Profile-listed text sources | 24 |
| Persistence/authority/integrity probes | 30 passed / 0 failed |
| Coordinated writable sources | 12 |
| Unchanged input source/profile hashes | 24 sources + 3 profiles |
| Private run permissions | 35 directories at 0700; 241 files at 0600 |
| Synthetic runner regression | 3 passed / 0 failed |
| Package typecheck | Passed |
| Legal review / GUI acceptance | NOT_RUN / NOT_RUN |

An earlier pilot exposed truncated large CLI pipe output despite exit 0. The CLI entrypoint was fixed separately, with source/bundle pipe regressions, before the successful rerun. The runner does not bypass the CLI or accept partial JSON. Private failed and successful evidence is retained outside Git; only these aggregate results are published here.
