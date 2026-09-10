# Telegram notifications

This repository sends selected GitHub events to a dedicated Telegram forum topic.

## Routing

| Setting | Value |
|---|---|
| Telegram group | `LawOSS (SLOVAKIA | CZECHIA) + AI Frontier Labs` |
| Repository | `Omni-Legal-Products/lawoss` |
| Default branch | `dev` |
| Topic | `GitHub · App` |
| Topic ID | `293` |
| Workflow | `.github/workflows/telegram-notify.yml` |

The coordination repository `Omni-Legal-Products/lawOSS-like-SK-CZ` uses the separate topic `GitHub · Ops` with topic ID `2`.

Both topics were renamed on 2026-08-14 (from `SK Mike GH` and `LAWOSS APP GH`) so the shared `GitHub ·` prefix keeps them together. Renaming a topic does not change its ID, so no workflow or variable was affected.

## GitHub Actions configuration

Repository variables:

```text
TELEGRAM_CHAT_ID=-1003828145652
TELEGRAM_TOPIC_ID=293
```

Required secret:

```text
TELEGRAM_TOKEN=<BotFather token for @mikeossSK_bot>
```

Never print, copy, commit, or add the token value to documentation, issues, pull requests, logs, or chat messages.

## Events

The workflow sends:

- pull request lifecycle events,
- issue lifecycle events,
- published releases,
- failures of the named CI and release workflows,
- a manual test through `workflow_dispatch`.

Routine pushes are intentionally not sent. This keeps the topic focused on events that require attention.

## Activation and test

1. Set `TELEGRAM_TOKEN` under repository or organization Actions secrets.
2. If it is an organization secret, grant this repository access.
3. Merge the workflow pull request into `dev`.
4. Open GitHub Actions and select `LAWOSS Telegram notifications`.
5. Run the workflow manually.
6. Confirm that the message arrives in `GitHub · App`.

## Troubleshooting

- A skipped notification usually means a variable or secret is missing.
- A Telegram API error can mean an invalid token, chat ID, topic ID, or insufficient bot permissions.
- If a CI workflow is renamed, update the names under `workflow_run.workflows`.
- GitHub does not reveal a stored secret value. Replace the secret if the token is unavailable.
- Keep the bot in the Telegram group with permission to post to forum topics.
