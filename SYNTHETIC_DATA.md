# Slovak synthetic OKF dataset v1

The full prebuilt dataset is a versioned asset in this repository's [dataset release](https://github.com/Omni-Legal-Products/lawoss/releases/tag/testdata-sk-okf-v1). Download it once and reuse it. No generation step is needed. The release is marked pre-release because it is test data, not an application build. GitHub's automatically generated “Source code” archives do **not** contain the corpus; use the named dataset ZIP below.

## Download and verify

- [Complete dataset ZIP](https://github.com/Omni-Legal-Products/lawoss/releases/download/testdata-sk-okf-v1/2026-10-17-lawoss-slovak-okf-synthetic-dataset-v1.zip) — 171,898,323 bytes (163.9 MiB).
- SHA-256: `0edddcc3c22eb8770ae13ad663be963c5446e1622c9a6b5146075fdf6ee4824c`.
- Archive root: `LAWOSS-SK-synthetic-v1/`; 5,792 files.
- [Machine-readable catalog](synthetic-dataset.json).

From the repository root, with Python 3 and curl installed (PowerShell users can use `curl.exe`):

```sh
mkdir -p .work/synthetic-sk
curl --fail --location --retry 3 'https://github.com/Omni-Legal-Products/lawoss/releases/download/testdata-sk-okf-v1/2026-10-17-lawoss-slovak-okf-synthetic-dataset-v1.zip' --output .work/synthetic-sk/dataset-v1.zip
python -c "import hashlib,pathlib; p=pathlib.Path('.work/synthetic-sk/dataset-v1.zip'); assert p.stat().st_size == 171898323; assert hashlib.file_digest(p.open('rb'),'sha256').hexdigest() == '0edddcc3c22eb8770ae13ad663be963c5446e1622c9a6b5146075fdf6ee4824c'; print('Dataset checksum OK')"
python -m zipfile -e .work/synthetic-sk/dataset-v1.zip .work/synthetic-sk
```

The checksum command requires Python 3.11+. Run extraction only after verification succeeds, into a fresh directory. If a verified archive already exists locally, reuse it. `.work/` is ignored; do not commit expanded fixtures. Leave the downloaded baseline untouched and copy selected offices/matters into a disposable run directory before testing mutations. The tools bundled inside the ZIP are for validation and maintenance, not a prerequisite to using the fixtures.

## Contents and selection

| Directory inside archive root | Purpose |
|---|---|
| `01_Neusporiadana_kancelaria/` | Raw office for onboarding, classification and sorting |
| `02_OKF_kancelaria/` | Structured OKF office, client/matter cards and memory |
| `03_Edge_cases/` | Individual negative and boundary scenarios |
| `ground-truth/` | Evaluator-only answers and expected results |
| `validation/` | Historical observed checks and limitations |
| `tools/` | Self-contained maintenance/validation tools and font assets |

Open one office, client or matter as the model's source. Keep `ground-truth/` and validation answers outside that selection to avoid answer leakage. Do not recursively extract nested test ZIPs; exercise negative fixtures individually in a disposable directory according to their scenario descriptions.

The corpus contains 24 fictional clients and 72 matters across 18 fact patterns, with 1,152 source documents preserved as 2,304 byte-identical copies across the raw and structured offices. Each matter has 16 source documents: three DOCX, three PDFs including a four-page raster scan, XLSX, EML with a real PDF attachment, TXT, CSV, JSON, XML, PNG, ZIP, HTML and RTF. Markdown cards and memory records are additional files. One office collection contains 1,307 PDF pages and 232,726 DOCX words. There are 66 typed-memory and six mapped-memory matters, canonical and legacy card names, 60 edge scenarios, native DOCX comments/revisions, PDF form fields and embedded PDF sources.

## Evidence and limits

Before publication, ZIP integrity and manifest hashes were verified, source formats parsed, raw/structured document hashes compared, workbook calculations independently reconciled and EML attachment bytes matched. The repository's bundled CLI validated 24 clients, 72 matter scaffolds, 66 typed-memory matters and six mapped-memory matters. Sixteen edge scenarios have observed CLI results. Representative documents were rendered and inspected. See `validation/REPORT.md` and its JSON reports for exact historical evidence.

The 60 scenarios describe expected behavior; they do not establish that 60 application journeys passed. Electron desktop, live-model behavior, OCR accuracy and Windows locks/ACLs still require testing. Run the relevant current application checks and report the version and actual result. The frozen CLI copies inside the archive are historical tools, not a substitute for current repository tests.

All identities and proceedings are fictional, with synthetic identifiers, deliberately invalid IČOs and `example.invalid` emails. Dates and legal text are test fixtures; no verified legal deadline, live registry result or actual legal decision is asserted.

## Versioning

This catalog pins v1 by tag, asset name, byte count and SHA-256. For a future revision, publish a new versioned asset and update this guide, catalog and identical root agent instructions together. Do not silently overwrite v1 or make regeneration the routine test setup. Tests requiring filesystem-specific conditions can use the packaged runtime tools on disposable copies; record which conditions were actually created and observed.
