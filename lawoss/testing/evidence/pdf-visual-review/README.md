# PDF visual review: synthetic mounted evidence

These screenshots show the production DocumentProcessingPanel and the production persistent ArtifactPanel/PDF viewer, connected to the production HTTP server, in an isolated Chromium profile. The generated `border.pdf` contains only labelled synthetic versions A/B/C and a decorative border. No real client/public-source document, token, server endpoint or private receipt is included.

- `refresh-pending.png`: B has been prepared while the already-open viewer still shows A. The explicit review-open download is held; confirmation stays disabled.
- `before-confirmation.png`: the same viewer owner has loaded the fresh immutable B blob, its SHA-256 matches the prepared B source, and the checkbox is available but unchecked.
- `after-confirmation.png`: the explicit synthetic host decision has a production HTTP receipt for B. The native panel shows reviewed coverage and the same viewer displays B.

The mounted regression also prepares C and deliberately replays the actual previously downloaded A response: its iframe can load, but the SHA mismatch keeps confirmation disabled and no C review is recorded. It asserts that the persistent host object and single path-deduplicated tab are retained. Embedded-child attestation remains blocked.

This is a mounted production-panel → persistent-viewer → HTTP boundary check, not full Electron/engine acceptance, human review of a real source, OCR accuracy validation or legal approval. The iframe load and immutable-blob hash prove which source was loaded; the lawyer still must inspect every listed page before confirming.

Replay from the repository root after `pnpm --filter legalwork-server build` using the pinned Node runtime and an explicitly selected isolated Chromium executable:

```sh
node lawoss/testing/documents/pdf-visual-review.browser.mjs /absolute/path/to/chromium /absolute/path/to/owned-output-directory
```

The runner creates synthetic inputs, a temporary profile and an owned Vite page; it restores globals/environment and stops owned resources in `finally`. Full receipts remain in the selected output directory, outside Git.
