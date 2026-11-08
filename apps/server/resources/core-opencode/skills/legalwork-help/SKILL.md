---
name: legalwork-help
description: Answer how-to questions about LAWOSS using its bundled Slovak and Czech manual. Use for app features, settings, navigation, localized controls and troubleshooting.
---

# LAWOSS help

<!-- 🟡 LAWOSS: the bundled manual is lawoss/user-guide (sk/ and cs/), see PATCHES.md. -->

For an ordinary how-to question, register this package in the chat once with `legalwork_skill_load` (`name="legalwork-help"`), read the matching page with `legalwork_skill_read`, then answer. `legalwork_skill_read` fails for a package that was not registered with `legalwork_skill_load` in this chat. This skill and that page are normally sufficient. Use the exact package reference, for example `name="legalwork-help", path="references/sk/integracie.md"`. Do not read the index, screen map or localization page first when the topic is already clear.

## Language

The manual exists in Slovak (`references/sk/`) and Czech (`references/cs/`) with the same file names. Answer in the language of the user's question. Read the Czech page when the user writes Czech and the Slovak page otherwise. If the language of the question is unclear, use the office's jurisdiction when it is already known from the conversation (CZ: Czech, SK: Slovak), otherwise Slovak. For a question in English or German, read the Slovak page, answer in the user's language and take exact control names for that language from the label helper.

## Topics

| Question | Page in `references/sk/` or `references/cs/` |
| --- | --- |
| First run, setup wizard, the Pokročilé (advanced) switch, app language | `zaciatok.md` |
| Sidebar, clients, cases, client overview, case page, quick actions, linked folders, files | `klienti-a-pripady.md` |
| Today page, deadlines register, documents waiting to be filed | `dnes-a-lehoty.md` |
| New chat, attachments, skills in chat, approval cards, YOLO Mode | `chaty.md` |
| AI providers, models, AI boundaries, OCR of scanned documents | `ai-a-modely.md` |
| LAWOSS Marketplace, MCP connectors, skills, plugins, file storage | `integracie.md` |
| Other settings: permissions, language, personalisation, secrets, privacy, updates | `nastavenia.md` |
| Advanced mode: Tasks, Workflows, Evaluations, Tabular Review, Office Add-ins | `pokrocily-rezim.md` |
| Where a screen is | `obrazovky.md` |
| Errors, missing model, unreadable overview, updates | `riesenie-problemov.md` |
| Exact control names in another language | `lokalizacia.md` |

## Answering

Answer directly and briefly, using the names the app shows in the user's language. Call the app LAWOSS. Use the LAWOSS terms: client (klient), case (prípad / případ), chat, linked folders (pripojené priečinky / připojené složky). Many screens differ with the Pokročilé switch on or off; say which mode a control needs when the page says so.

Describe only what the manual establishes. If no page covers a feature, say that LAWOSS does not offer it in this version or that the manual does not establish it; do not describe it from general knowledge or from translation keys. Entries in the [screen inventory](references/screens.json) marked `"hidden": true` are not shown in LAWOSS.

Reuse the page's `legalwork://app/...` links as natural labels, for example [Integrácie](legalwork://app/settings/extensions/plugins). Clicking one navigates inside LAWOSS. Do not invent destinations or turn an explanation into a settings change.

A how-to question does not require checking the user's account, installed integrations or screen. Do not take UI snapshots, list files, call connectors or inspect status just to explain documented steps. Read another page only if the first leaves a specific part of the question unanswered. Use live tools when the user asks you to perform an action, diagnose a reported failure or check their actual configuration.

For an exact translated control that you cannot establish from the page, use the localization page and the read-only label helper. The [label table](references/i18n.json) contains all existing locale tables; avoid reading that entire file. Run the helper through `legalwork_shell` with this loaded skill's returned mount path and `skills` argument, following the shell tool contract. For example, pass the helper path followed by `cs settings.tab_ai`. A label in the table does not prove that the control is visible in LAWOSS, and the app shows LAWOSS where the table says LegalWork.

This skill is app help, not legal advice or a source of matter facts.
