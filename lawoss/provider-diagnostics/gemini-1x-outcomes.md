# Gemini 1.x: preserved reasoning and explicit turn outcomes

The pinned engine remains OpenCode 1.18.29. This change makes an otherwise empty failed turn visible through LAWOSS session snapshots; it does **not** claim to fix the original intermittent Gemini signature rejection.

## Boundaries

- The existing managed capabilities plugin reads the current native assistant, its originating user, provider and model before dispatch. This read requests only the latest message.
- A random local correlation header is removed before provider fetch. Request bodies and opaque reasoning/signature bytes remain unchanged.
- Only HTTP 400 with the specific Gemini thought-signature rejection is classified. Error bodies are observed while forwarding their original bytes, with a 32 KiB bound; the observer never persists raw content.
- The engine credential can submit only within its own workspace/session. The server independently verifies the actual assistant ID, user parent, provider and model. Ordinary client credentials cannot submit a provider witness.
- A closed failure code is stored in the existing app-owned runtime database lifecycle. The engine database is not edited.
- The read model adds an error only to an idle, completed, empty Gemini assistant lacking both a finish reason and an existing error. Successful retries and tool-call steps take precedence. Without a verified witness, the same shape is labelled incomplete with unknown cause.

## Verification on 2026-10-18

TDD first observed the missing managed hook and endpoint (undefined hook; HTTP 404), then the missing incomplete-state explanation. Focused tests now cover scoped authorization, parent/model mismatch, successful retry/tool-step suppression, bounded raw-body forwarding, hidden correlation, current native assistant correlation and persistence across server restart.

The optional native test executes synthetic fixtures against the actual pinned binary, checks the streamed tool round trip, disposes/reloads the native instance and checks replay, then injects a real HTTP 400 response and verifies the native assistant correlation. Run it with:

```sh
LEGALWORK_TEST_OPENCODE_BIN=/absolute/path/to/opencode bun test apps/server/src/opencode-plugins/lawoss-gemini-reasoning.integration.test.ts
```

Two separate authorized live checks used fresh disposable backends/profiles and copies of the frozen public office, with ground truth excluded. Both reused the ten original agentic prompts, tool whitelist and high reasoning effort.

| Diagnostic relay | Completed JSON responses | Tool calls | Provider requests | Exact outgoing encrypted-detail checks | Signature rejections |
| --- | ---: | ---: | ---: | ---: | ---: |
| Reconstructed Authorization/Content-Type | 10/10 | 75 | 60 | 184/184 | 0 |
| Preserved incidental SDK headers; only authorization/hop headers handled locally | 10/10 | 67 | 51 | 132/132 | 0 |

Each encrypted detail was matched to preceding upstream SSE details by case and tool-call ID. All ten final snapshots in each run remained successful after the application's engine-reload endpoint.

Public fixture manifest SHA-256: `e7cd7b73470269a1e02b0267b5a627db2dd02f05909f80f68a013a2cec7c965b`.

These observations do not establish a repair of the earlier failing runs. Their upstream request wire was not captured, so the original loss/corruption boundary remains unknown. The first relay omitted incidental SDK headers; the second preserved them while removing hop-by-hop/Host/content-length headers and replacing authorization in memory. The provider field reported Google in both runs; this does not identify the lower Google routing backend or prove equivalence to an earlier route. JSON completion also does not validate legal conclusions, extraction completeness or OCR.

Private captures remain outside Git. No actual provider credential was copied into the disposable engine profile. This observer does not log provider bodies, headers, opaque details or credentials.

## Primary references

- [OpenRouter: preserving reasoning blocks](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#preserving-reasoning-blocks).
- [OpenRouter SDK issue 418 and the unsigned Gemini reasoning guard](https://github.com/OpenRouterTeam/ai-sdk-provider/issues/418). The bundled SDK's existing guard is preserved.
- [Pinned engine LLM error callback](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/opencode/src/session/llm.ts): logging a stream error alone does not provide a durable LAWOSS turn outcome.

## Remaining work

Capture a failing native request with the same causal upstream/persistence/outgoing comparison before changing signature replay. An exact failing boundary is required for a signature repair; the current successful sample is not proof that the intermittent defect is gone. ADR-0016 coordination and engine-version migration remain deferred.
