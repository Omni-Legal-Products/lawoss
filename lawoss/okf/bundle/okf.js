#!/usr/bin/env node
// @lawoss/okf — vygenerované z src/ cez `bun run build`. Needitovať ručne.
// @bun

// src/cli.ts
import { realpathSync } from "fs";
import { fileURLToPath } from "url";

// src/core.ts
var ENTITY_TYPES = ["klient", "spis", "projekt"];

// src/fs.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

// src/core.ts
var OKF_VERSION = "0.1";
var ENTITY_TYPES2 = ["klient", "spis", "projekt"];
var CARD_FILE = { klient: "klient.md", spis: "spis.md", projekt: "projekt.md" };
function today() {
  return new Date().toISOString().slice(0, 10);
}
function renderTemplate(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => vars[key] ?? "");
}
function templateVars(input) {
  const date = input.date ?? today();
  return {
    TITLE: input.title,
    KLIENT: input.type === "klient" ? input.title : input.klient ?? "",
    KLIENT_ICO: input.ico ?? "",
    DESCRIPTION: input.description ?? "",
    RESOURCE: "",
    PROTISTRANA: input.protistrana ?? "",
    PROTISTRANA_ICO: input.protistranaIco ?? "",
    OBLAST: input.oblast ?? "",
    SPZN: input.spzn ?? "",
    SUD: input.sud ?? "",
    DATE: date
  };
}
function planEntity(input, templates, exists) {
  const vars = templateVars(input);
  const files = templates[input.type];
  const entries = [];
  const push = (path, content) => {
    entries.push(exists(path) ? { path, action: "skip", reason: "exists" } : { path, action: "create", content });
  };
  for (const [name, template] of Object.entries(files))
    push(name, renderTemplate(template, vars));
  const agents = entries.find((entry) => entry.path === "AGENTS.md");
  push("CLAUDE.md", agents?.content ?? renderTemplate(files["AGENTS.md"], vars));
  if (input.type === "klient") {
    push("index.md", `---
okf_version: "${OKF_VERSION}"
---

# ${input.title}

## Spisy
`);
    push("Spisy/.keep", "");
  }
  return { okfVersion: OKF_VERSION, type: input.type, dir: input.dir, entries };
}
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---")
    return null;
  const out = {};
  for (let i = 1;i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "---")
      return out;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (match)
      out[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return null;
}
function validateMarkdown(relativePath, text, isRoot) {
  const base = relativePath.split("/").pop() ?? relativePath;
  if (base === "log.md")
    return null;
  const fm = parseFrontmatter(text);
  if (base === "index.md") {
    if (!fm)
      return null;
    if (!isRoot)
      return { path: relativePath, message: "index.md nesmie mať frontmatter (rezervovaný zoznam)" };
    const extra = Object.keys(fm).filter((key) => key !== "okf_version");
    return extra.length ? { path: relativePath, message: "koreňový index.md smie niesť iba okf_version" } : null;
  }
  if (!fm || !fm.type?.trim()) {
    return { path: relativePath, message: "concept document bez neprázdneho `type:` vo frontmatteri" };
  }
  return null;
}

// templates/klient/AGENTS.md
var AGENTS_default = `---
type: agents
title: {{KLIENT}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — klientsky vstupný bod ({{KLIENT}})

> Zrkadlené s \`CLAUDE.md\`.

Najprv prečítaj [\`klient.md\`](./klient.md) a [\`index.md\`](./index.md) (zoznam spisov).
Pracuješ na konkrétnej veci? → choď do jej priečinka a riaď sa tamojším \`AGENTS.md\`.

<!-- okf:protokol-zapisu:v1 -->
## PROTOKOL ZÁPISU (povinný)

> Čo nezapíšeš, pre budúceho agenta neexistuje.

| Čo sa objavilo | Kam to zapísať |
|---|---|
| trvalý fakt o klientovi (preferencie, štruktúra, kontakty, citlivosti) | \`MEMORY.md\` tohto priečinka |
| fakt / udalosť / lehota KONKRÉTNEJ veci | do \`_STATUS.md\` daného spisu (nie sem) |
| nový spis založený | over, že je v [\`index.md\`](./index.md) (\`index-gen.sh\`) |

**Pred ukončením práce:** zapísané všetko z tabuľky? \`updated:\` bumpnuté? \`CLAUDE.md\` v sync-u?

## Univerzálne komunikačné pravidlá pre klienta
- Default jazyk: slovenský, formálny obchodno-právny register.
- Žiadna citácia „z hlavy"; pri sporných postupoch dotaz Marianovi pred odoslaním.
`;

// templates/klient/MEMORY.md
var MEMORY_default = `---
type: memory
title: {{KLIENT}} — Memory
updated: {{DATE}}
---

# MEMORY.md — durable fakty o klientovi ({{KLIENT}})
`;

// templates/klient/klient.md
var klient_default = `---
type: klient
title: {{KLIENT}}
description: {{DESCRIPTION}}
ico: "{{KLIENT_ICO}}"
status: aktívny
tags: []
timestamp: {{DATE}}
updated: {{DATE}}
---

# {{KLIENT}}

{{DESCRIPTION}}

## Spisy
*(zoznam generuje \`index-gen.sh\` do [\`index.md\`](./index.md))*
`;

// templates/spis/AGENTS.md
var AGENTS_default2 = `---
type: agents
title: {{TITLE}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — vstupný bod pre AI v tomto spise

> Zrkadlené s \`CLAUDE.md\`. Po zmene spusti \`sync_agents_claude.sh\`.

**Poradie čítania:** 1) [\`spis.md\`](./spis.md) 2) [\`_STATUS.md\`](./_STATUS.md) — najmä **Fáza / Ďalší krok** 3) [\`MEMORY.md\`](./MEMORY.md) 4) klient [\`../../AGENTS.md\`](../../AGENTS.md).

<!-- okf:protokol-zapisu:v1 -->
## PROTOKOL ZÁPISU (povinný)

> Kontext konverzácie sa stráca. Tento priečinok je jediná trvalá pamäť veci —
> **čo nezapíšeš, pre budúceho agenta neexistuje.**

**Počas práce — zapíš HNEĎ, keď sa objaví:**

| Čo sa objavilo | Kam to zapísať |
|---|---|
| nový FAKT veci (tvrdenie, zistenie, priznanie, stav veci) | \`_STATUS.md\` → § Fakty veci |
| udalosť (podanie, doručenie, pojednávanie, hovor, výzva) | \`_STATUS.md\` → § Chronológia |
| nová / zmenená / zmeškaná LEHOTA | \`spis.md\` frontmatter \`lehoty:\` **a** \`_STATUS.md\` → § Lehoty |
| taktické rozhodnutie, stratégia („takto áno / takto nie") | \`MEMORY.md\` → TP-XXX |
| poučenie, prekvapenie, čo nabudúce inak | \`MEMORY.md\` → LL-XXX |
| otvorená otázka bez odpovede | \`MEMORY.md\` → OQ-XXX |
| nový dokument (prijatý aj náš výstup) | správny podpriečinok **a** \`_STATUS.md\` → § Kľúčové dokumenty |
| e-mail thread / tel. hovor / správa relevantná pre vec | \`_STATUS.md\` → § Komunikácia |
| nová úloha alebo záväzok (náš aj klientov) | \`_STATUS.md\` → § Otvorené úlohy |

**Pred ukončením práce — HARD GATE (nikdy nekonči odpoveď bez tohto):**

- [ ] Všetko z tabuľky vyššie je zapísané? (prejdi konverzáciu spätne)
- [ ] \`_STATUS.md\`: **Fáza** a **Ďalší krok** navrchu zodpovedajú realite po tejto práci?
- [ ] \`updated:\` vo frontmatteri každého zmeneného súboru bumpnuté na dnešný dátum?
- [ ] Menil si \`AGENTS.md\`? → zosynchronizuj \`CLAUDE.md\` (\`sync_agents_claude.sh\`)

## Komunikačné pravidlá (tento spis)
- Citácie predpisov/judikátov VŽDY cez MCP (slovlex/judikáty); zdroje pod \`# Citations\`.
- Korporátne údaje protistrany overené cez ORSR/RPO, nie z pamäte.
- {{DESCRIPTION}}

## Checklist pred odoslaním dokumentu von
- [ ] citácie overené cez MCP
- [ ] údaje protistrany overené cez ORSR
- [ ] dokument uložený do \`2 - Drafty/\` ako \`YYYY-MM-DD typ - popis.ext\`
- [ ] \`_STATUS.md\` aktualizovaný (dokument + chronológia)
`;

// templates/spis/MEMORY.md
var MEMORY_default2 = `---
type: memory
title: {{TITLE}} — Memory
updated: {{DATE}}
---

# MEMORY.md — projektová pamäť ({{TITLE}})

## Taktické pravidlá
*(TP-001, TP-002, …)*

## Lessons learned
*(LL-001, …)*

## Otvorené otázky
*(OQ-001, …)*
`;

// templates/spis/_STATUS.md
var _STATUS_default = `---
type: status
title: {{TITLE}} — Status
updated: {{DATE}}
---

# {{TITLE}} — Status (SSOT)

> **Fáza:** _(jedna veta — kde vec práve stojí)_
> **Ďalší krok:** _(čo sa má stať najbližšie + kto to má urobiť + dokedy)_

## 1. Strany
| Rola | Subjekt | IČO | Kontakt |
|---|---|---|---|
| Klient | {{KLIENT}} | {{KLIENT_ICO}} | |
| Protistrana | {{PROTISTRANA}} | {{PROTISTRANA_ICO}} | |

## 2. Fakty veci
*(každý fakt zistený pri práci — tvrdenia strán, zistenia z dokumentov, priznania, technický stav)*

| # | Fakt | Zdroj | Zistené | Dopad na vec |
|---|---|---|---|---|

## 3. Lehoty
| Dátum | Typ | Zdroj | Stav |
|---|---|---|---|

## 4. Chronológia
| Dátum | Udalosť | Zdroj |
|---|---|---|

## 5. Otvorené úlohy
| # | Úloha | Termín | Status | Kto |
|---|---|---|---|---|

## 6. Kľúčové dokumenty
| Typ | Lokácia |
|---|---|

## 7. Komunikácia
*(Gmail thread ID / spisová značka podania / tel. — aby budúci agent našiel kontext)*

| Kanál | Identifikátor | Téma | Posledná aktivita |
|---|---|---|---|
`;

// templates/spis/spis.md
var spis_default = `---
type: spis
title: {{TITLE}}
description: {{DESCRIPTION}}
resource: {{RESOURCE}}
klient: {{KLIENT}}
klient_ico: "{{KLIENT_ICO}}"
protistrana: {{PROTISTRANA}}
protistrana_ico: "{{PROTISTRANA_ICO}}"
oblast_prava: [{{OBLAST}}]
spisova_znacka: "{{SPZN}}"
sud: "{{SUD}}"
status: aktívny
lehoty: []
advokat: Marián Čuprík
tags: []
timestamp: {{DATE}}
updated: {{DATE}}
---

# {{TITLE}}

{{DESCRIPTION}}

## Navigácia
- SSOT: [\`_STATUS.md\`](./_STATUS.md)
- Pamäť: [\`MEMORY.md\`](./MEMORY.md)
- Klient: [\`../../klient.md\`](../../klient.md)
`;

// templates/projekt/AGENTS.md
var AGENTS_default3 = `---
type: agents
title: {{TITLE}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — projektový vstupný bod ({{TITLE}})

Najprv prečítaj [\`projekt.md\`](./projekt.md) a [\`MEMORY.md\`](./MEMORY.md).

<!-- okf:protokol-zapisu:v1 -->
## PROTOKOL ZÁPISU (povinný)

> Čo nezapíšeš, pre budúceho agenta neexistuje.

| Čo sa objavilo | Kam to zapísať |
|---|---|
| rozhodnutie / zmena smeru | \`MEMORY.md\` |
| poučenie, čo nabudúce inak | \`MEMORY.md\` (LL-XXX) |
| otvorená otázka | \`MEMORY.md\` (OQ-XXX) |
| zmena stavu / milestone | \`projekt.md\` frontmatter (\`status\`, \`milestones\`) + \`_STATUS.md\` ak existuje |

**Pred ukončením práce:** zapísané? \`updated:\` bumpnuté v zmenených súboroch?
`;

// templates/projekt/MEMORY.md
var MEMORY_default3 = `---
type: memory
title: {{TITLE}} — Memory
updated: {{DATE}}
---

# MEMORY.md — rozhodnutia a lessons learned ({{TITLE}})
`;

// templates/projekt/projekt.md
var projekt_default = `---
type: projekt
title: {{TITLE}}
description: {{DESCRIPTION}}
klient: {{KLIENT}}
status: aktívny
milestones: []
tags: []
timestamp: {{DATE}}
updated: {{DATE}}
---

# {{TITLE}}

{{DESCRIPTION}}

## Navigácia
- Pamäť: [\`MEMORY.md\`](./MEMORY.md)
`;

// src/templates.ts
var TEMPLATES = {
  klient: { "klient.md": klient_default, "AGENTS.md": AGENTS_default, "MEMORY.md": MEMORY_default },
  spis: { "spis.md": spis_default, "_STATUS.md": _STATUS_default, "AGENTS.md": AGENTS_default2, "MEMORY.md": MEMORY_default2 },
  projekt: { "projekt.md": projekt_default, "AGENTS.md": AGENTS_default3, "MEMORY.md": MEMORY_default3 }
};

// src/fs.ts
function readText(path) {
  return readFileSync(path, "utf8");
}
function listMarkdown(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("."))
        continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "templates" || entry.name === "node_modules")
          continue;
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        out.push(relative(root, full).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}
function detect(dir, hint) {
  const isDir = existsSync(dir) && statSync(dir).isDirectory();
  const base = {
    dir,
    isDir,
    type: null,
    hasAgents: false,
    hasClaude: false,
    claudeIsMirror: null,
    okfVersion: null,
    markdownCount: 0,
    missing: []
  };
  if (!isDir)
    return base;
  const type = ENTITY_TYPES2.find((candidate) => existsSync(join(dir, CARD_FILE[candidate]))) ?? null;
  const hasAgents = existsSync(join(dir, "AGENTS.md"));
  const hasClaude = existsSync(join(dir, "CLAUDE.md"));
  const claudeIsMirror = hasAgents && hasClaude ? readText(join(dir, "AGENTS.md")) === readText(join(dir, "CLAUDE.md")) : null;
  const indexPath = join(dir, "index.md");
  const okfVersion = existsSync(indexPath) ? parseFrontmatter(readText(indexPath))?.okf_version ?? null : null;
  const effective = type ?? hint ?? null;
  const missing = effective ? planEntity({ type: effective, dir, title: "" }, TEMPLATES, (p) => existsSync(join(dir, p))).entries.filter((entry) => entry.action === "create").map((entry) => entry.path) : [];
  return { ...base, type, hasAgents, hasClaude, claudeIsMirror, okfVersion, markdownCount: listMarkdown(dir).length, missing };
}
function plan(input) {
  return planEntity(input, TEMPLATES, (p) => existsSync(join(input.dir, p)));
}
function apply(p) {
  const created = [];
  const skipped = [];
  mkdirSync(p.dir, { recursive: true });
  for (const entry of p.entries) {
    const full = join(p.dir, entry.path);
    if (entry.action !== "create" || existsSync(full)) {
      skipped.push(entry.path);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, entry.content ?? "", "utf8");
    created.push(entry.path);
  }
  return { created, skipped };
}
function validate(root) {
  if (!existsSync(root))
    return [{ path: root, message: "priečinok neexistuje" }];
  const errors = [];
  for (const rel of listMarkdown(root)) {
    const error = validateMarkdown(rel, readText(join(root, rel)), !rel.includes("/"));
    if (error)
      errors.push(error);
  }
  return errors;
}
function render(root) {
  const written = [];
  const kept = [];
  const agents = join(root, "AGENTS.md");
  const claude = join(root, "CLAUDE.md");
  if (existsSync(agents)) {
    const a = readText(agents);
    if (!existsSync(claude)) {
      writeFileSync(claude, a, "utf8");
      written.push("CLAUDE.md");
    } else if (readText(claude) === a)
      kept.push("CLAUDE.md");
    else
      kept.push("CLAUDE.md (upravený ručne — nechaný)");
  }
  const index = join(root, "index.md");
  if (existsSync(index)) {
    const text = readText(index);
    const fm = parseFrontmatter(text);
    const head = fm ? text.slice(0, text.indexOf(`
---`, 3) + 4) : "";
    const cards = listMarkdown(root).filter((rel) => rel.includes("/") && /\/(spis|projekt|klient)\.md$/.test(rel));
    const body = cards.length ? cards.map((rel) => `- [${rel.split("/").slice(0, -1).join("/")}](./${rel})`).join(`
`) : "_(zatiaľ žiadne)_";
    const next = `${head}

# Obsah

${body}
`;
    if (next !== text) {
      writeFileSync(index, next, "utf8");
      written.push("index.md");
    } else
      kept.push("index.md");
  }
  return { written, kept };
}

// src/cli.ts
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0;i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--"))
      flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { positional, flags };
}
function str(flags, key) {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}
function entityType(value) {
  if (value && ENTITY_TYPES.includes(value))
    return value;
  throw new Error(`typ mus\xED by\u0165 ${ENTITY_TYPES.join(" | ")}; dostal som: ${value ?? "(ni\u010D)"}`);
}
function inputFrom(positional, flags) {
  const type = entityType(positional[1]);
  const dir = positional[2];
  if (!dir)
    throw new Error("ch\xFDba <dir>");
  const title = str(flags, "title") ?? dir.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return {
    type,
    dir,
    title,
    description: str(flags, "desc"),
    ico: str(flags, "ico"),
    klient: str(flags, "klient"),
    protistrana: str(flags, "protistrana"),
    protistranaIco: str(flags, "protistrana-ico"),
    oblast: str(flags, "oblast"),
    spzn: str(flags, "spzn"),
    sud: str(flags, "sud"),
    date: str(flags, "date")
  };
}
function run(argv, out = console.log) {
  const { positional, flags } = parseArgs(argv);
  const json = flags.json === true;
  const cmd = positional[0];
  try {
    switch (cmd) {
      case "detect": {
        const dir = positional[1];
        if (!dir)
          throw new Error("ch\xFDba <dir>");
        const hint = str(flags, "type");
        const result = detect(dir, hint ? entityType(hint) : undefined);
        if (json) {
          out(JSON.stringify(result, null, 2));
          return 0;
        }
        if (!result.isDir) {
          out(`nie je prie\u010Dinok: ${dir}`);
          return 1;
        }
        out(`${dir}`);
        out(`  typ: ${result.type ?? "\u2014 (bez OKF karty)"}   AGENTS.md: ${result.hasAgents ? "\xE1no" : "nie"}   CLAUDE.md: ${result.hasClaude ? result.claudeIsMirror ? "mirror" : "vlastn\xFD" : "nie"}`);
        out(`  okf_version: ${result.okfVersion ?? "\u2014"}   markdown s\xFAborov: ${result.markdownCount}`);
        out(result.missing.length ? `  ch\xFDba: ${result.missing.join(", ")}` : "  ch\xFDba: ni\u010D");
        return 0;
      }
      case "plan": {
        const p = plan(inputFrom(positional, flags));
        if (json) {
          out(JSON.stringify({ ...p, entries: p.entries.map(({ content: _c, ...e }) => e) }, null, 2));
          return 0;
        }
        out(`pl\xE1n pre ${p.type} v ${p.dir} \u2014 ni\u010D sa nezap\xEDsalo`);
        for (const e of p.entries)
          out(`  ${e.action === "create" ? "+" : "="} ${e.path}${e.action === "skip" ? "   (existuje, bez zmeny)" : ""}`);
        return 0;
      }
      case "apply": {
        const result = apply(plan(inputFrom(positional, flags)));
        if (json) {
          out(JSON.stringify(result, null, 2));
          return 0;
        }
        for (const f of result.created)
          out(`+ ${f}`);
        for (const f of result.skipped)
          out(`= ${f}   (existuje, bez zmeny)`);
        out(`vytvoren\xE9: ${result.created.length}, presko\u010Den\xE9: ${result.skipped.length}`);
        return 0;
      }
      case "validate": {
        const dir = positional[1];
        if (!dir)
          throw new Error("ch\xFDba <dir>");
        const errors = validate(dir);
        if (json) {
          out(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
          return errors.length ? 1 : 0;
        }
        for (const e of errors)
          out(`ERROR: ${e.path} \u2014 ${e.message}`);
        out(errors.length ? `${errors.length} ch\xFDb` : `OK: ${dir} je konformn\xFD (OKF v0.1)`);
        return errors.length ? 1 : 0;
      }
      case "render": {
        const dir = positional[1];
        if (!dir)
          throw new Error("ch\xFDba <dir>");
        const result = render(dir);
        if (json) {
          out(JSON.stringify(result, null, 2));
          return 0;
        }
        for (const f of result.written)
          out(`~ ${f}   (pregenerovan\xE9)`);
        for (const f of result.kept)
          out(`= ${f}`);
        return 0;
      }
      default:
        out("okf detect|plan|apply|validate|render \u2014 pozri hlavi\u010Dku src/cli.ts");
        return cmd ? 2 : 0;
    }
  } catch (error) {
    out(`okf: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
var isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain)
  process.exit(run(process.argv.slice(2)));
export {
  run
};
