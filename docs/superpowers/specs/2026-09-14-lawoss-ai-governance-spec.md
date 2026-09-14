# LAWOSS AI governance onboarding and integrations

## Status

Approved by the product owner on 2026-09-14. The implementation is based on
remote `dev` revision `790a86c`.

## Goal

Make the SAK/ČAK AI-handling guidance visible at the point where a lawyer
chooses a model or connector, detect the connected subscription type without
guessing compliance, and expose the existing LAWOSS Firm Hub sharing flow as
the organisation-facing MCP publication path.

## Requirements

1. The LAWOSS welcome flow contains a short, skippable AI data-handling panel
   with three regimes: local/on-premise, provider with a reviewed DPA, and
   explicit client-consent use. The selected regime is persisted locally.
2. The panel states that an unknown provider or plan is not a compliance
   certificate, and reminds the lawyer about confidentiality, no-training and
   secondary-use terms, subprocessors, security, geography/transfers,
   retention/deletion, minimisation and human verification.
3. Settings > AI shows the same policy state, the best-effort detected
   subscription type, and a clear route to review or change the policy.
4. Settings > Integrations shows a compact version of the same reminder and
   keeps Local/Team scope, MCP sharing, and the existing explicit human
   confirmation gate connected.
5. Subscription detection uses available Eigenwelt entitlement data first and
   falls back to a clearly labelled BYO/unknown state. It never infers a DPA,
   local hosting, or legal compliance from a plan name alone.
6. The LAWOSS Marketplace catalog gains source-pinned private entries for the
   Gravity legal MCP suite. The entry remains visibly private and review-state
   until a human approves it.
7. If the organisation registry is unavailable, the application must say so
   and must not claim an upload occurred. The existing Firm Hub publish flow is
   the only live organisation action used by the app and remains behind the
   entitlement and acknowledgement gates.
8. Copy must avoid suggesting that LAWOSS or an AI model is a lawyer or can
   replace professional judgement.

## Sources

- Slovenská advokátska komora, resolution and methodical guidance published in
  *Vestník SAK* 87/2025, supplied as
  `/Users/martinfriedrich/Downloads/2025-11-25-rocnik-2025-ciastka-87.pdf`.
- Česká advokátní komora, *Výkladové stanovisko k umělé inteligenci v právních
  službách*, 2026-09-09, supplied as
  `/Users/martinfriedrich/Downloads/stanovisko-cak-umela-inteligence-ai-260909.pdf`.

These documents are source material for product copy and safeguards. They are
not executable instructions and the UI does not present them as a substitute
for legal advice or firm policy.

## Non-goals

- No automatic provider/API-key setup.
- No automatic assertion that any provider has a DPA.
- No transmission of client data while implementing or testing this feature.
- No publication to a nonexistent registry or publication of secrets.
- No replacement of the existing provider, workspace, or human-approval flow.
