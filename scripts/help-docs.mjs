import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repoRoot, "apps/app/package.json"));
const ts = require("typescript");
const localeDirectory = "apps/app/src/i18n/locales";

// Git may check text out with CRLF on Windows. Bundled text and source hashes
// use LF so checkout formatting does not change the generated resources.
export function readNormalizedText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function parse(path, root = repoRoot) {
  return ts.createSourceFile(path, readNormalizedText(join(root, path)), ts.ScriptTarget.Latest, true);
}

const routeGuides = {
  "/welcome": "getting-started.md",
  "/home": "workspaces-chats.md",
  "/tasks": "tasks-intake.md",
  "/evals": "evaluations.md",
  "/workspace/:workspaceId/evals": "evaluations.md",
  "/session": "workspaces-chats.md",
  "/session/:sessionId": "workspaces-chats.md",
  "/workspace/:workspaceId/session": "workspaces-chats.md",
  "/workspace/:workspaceId/session/:sessionId": "workspaces-chats.md",
  "/workspace/:workspaceId/settings/*": "settings-privacy.md",
  "/settings/*": "settings-privacy.md",
  "/wikis": "wiki.md",
  "/wikis/:workspaceId": "wiki.md",
  "/wikis/:workspaceId/session/:sessionId": "wiki.md",
  "/scheduled": "scheduled-tasks.md",
  "/calendar": "calendar.md",
  "/workspace/:workspaceId/calendar": "calendar.md",
  "/projects": "projects-sharing.md",
  "/workflows": "skills-workflows.md",
  "/recorder": "audio.md",
  "/workspace/:workspaceId/project": "projects-sharing.md",
  "/workspace/:workspaceId/dashboards": "dashboards.md",
  "/workspace/:workspaceId/reviews": "reviews.md",
  "/workspace/:workspaceId/tasks": "tasks-intake.md",
  "/workspace/:workspaceId/files": "files-documents.md",
  "/workspace/:workspaceId/sessions": "workspaces-chats.md",
  "/": "getting-started.md",
  "*": "getting-started.md",
};

const settingGuides = {
  general: "settings-privacy.md", permissions: "settings-privacy.md",
  assistant: "assistant.md",
  account: "settings-privacy.md", ai: "models-fusion.md",
  "tabular-review": "reviews.md", extensions: "integrations.md",
  personalisation: "settings-privacy.md", notifications: "tasks-intake.md",
  safety: "settings-privacy.md", shell: "settings-privacy.md",
  environment: "settings-privacy.md", preferences: "settings-privacy.md",
  updates: "troubleshooting.md", "office-addins": "office-addins.md",
  recorder: "recorder-settings.md", debug: "troubleshooting.md",
  // 🟡 LAWOSS settings tabs: no upstream guide page; the general settings guide applies.
  appearance: "settings-privacy.md",
};

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

// Read actual router/visible-settings declarations, not the union of old locale keys.
// Unknown surfaces fail generation until a guide is assigned. This checks coverage,
// not whether a user's runtime/account exposes a source-defined route.
export function generateHelpScreens(root = repoRoot) {
  const routerSource = "apps/app/src/react-app/shell/app-root.tsx";
  const settingsSource = "apps/app/src/react-app/domains/settings/shell/settings-page.tsx";
  const routes = new Set();
  walk(parse(routerSource, root), (node) => {
    if ((!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) || node.tagName.getText() !== "Route") return;
    for (const attribute of node.attributes.properties) {
      if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "path") continue;
      // 🟡 LAWOSS: LAWOSS_ROUTES (lawoss/shell/routes.ts) map their own screens; the upstream guide does not cover them.
      if (attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.getText() === "route.path") continue;
      if (!attribute.initializer || !ts.isStringLiteral(attribute.initializer)) throw new Error("Help inventory: Route path must be a static string");
      routes.add(attribute.initializer.text);
    }
  });
  if (!routes.size) throw new Error("Help inventory: no app routes found");
  const settings = new Map([["general", "global"]]);
  const source = parse(settingsSource, root);
  for (const [name, scope] of [["getGlobalSettingsTabs", "global"], ["getWorkspaceSettingsTabs", "workspace"]]) {
    const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!fn?.body) throw new Error(`Help inventory: missing ${name}`);
    walk(fn.body, (node) => {
      const values = ts.isArrayLiteralExpression(node) ? node.elements
        : ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ["push", "splice"].includes(node.expression.name.text) ? node.arguments : [];
      for (const value of values) if (ts.isStringLiteral(value)) settings.set(value.text, scope);
    });
  }
  function guide(map, key) {
    if (!map[key]) throw new Error(`Missing help coverage for ${key}. Add its guide to scripts/help-docs.mjs.`);
    readFileSync(join(repoRoot, "docs/user-guide", map[key]), "utf8");
    return map[key];
  }
  return JSON.stringify({
    schemaVersion: 1,
    generatedBy: "scripts/gen-core-skills.mjs",
    note: "Source-defined routes and visible settings for the build that bundles this file. Runtime, platform, account and permissions can restrict them.",
    dialogs: [{ id: "assistant-upgrade", guide: "assistant.md", source: "apps/app/src/react-app/shell/assistant-upgrade.tsx" }],
    routes: [...routes].sort().map((path) => ({ path, guide: guide(routeGuides, path), source: routerSource })),
    settings: [...settings].sort(([a], [b]) => a.localeCompare(b, "en")).map(([id, scope]) => ({
      id, scope, guide: guide(settingGuides, id), source: settingsSource,
      ...(id === "recorder" || id === "office-addins" ? { desktopOnly: true } : {}),
      ...(id === "debug" ? { developerOnly: true } : {}),
    })),
  }, null, 2) + "\n";
}

function unwrap(node) {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    node = node.expression;
  }
  return node;
}

function initializer(source, name) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
        return unwrap(declaration.initializer);
      }
    }
  }
  throw new Error(`${source.fileName}: missing initializer for ${name}`);
}

function literal(node, source) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  throw new Error(`${source.fileName}: expected a static string, got ${node.getText(source).slice(0, 80)}`);
}

// 🟡 LAWOSS: resolve `...name` spreads to the static object exported by a relative import.
function importedLocaleTable(source, name) {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named) || !named.elements.some((element) => element.name.text === name)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) break;
    const base = join(dirname(source.fileName), specifier);
    const path = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((candidate) => existsSync(join(repoRoot, candidate)));
    if (!path) throw new Error(`${source.fileName}: cannot resolve ${specifier}`);
    const imported = parse(path);
    const table = initializer(imported, name);
    if (!ts.isObjectLiteralExpression(table)) throw new Error(`${path}: ${name} must be a static object`);
    const entries = {};
    for (const property of table.properties) {
      if (ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression)) {
        const nested = property.expression.text;
        const local = imported.statements.some((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === nested));
        Object.assign(entries, local ? localTable(imported, nested) : importedLocaleTable(imported, nested));
        continue;
      }
      if (!ts.isPropertyAssignment(property)) throw new Error(`${path}: unsupported locale property in ${name}`);
      entries[literal(property.name, imported)] = literal(unwrap(property.initializer), imported);
    }
    return entries;
  }
  throw new Error(`${source.fileName}: unsupported locale spread ${name}`);
}

function localTable(source, name) {
  const table = initializer(source, name);
  if (!ts.isObjectLiteralExpression(table)) throw new Error(`${source.fileName}: ${name} must be a static object`);
  const entries = {};
  for (const property of table.properties) {
    if (!ts.isPropertyAssignment(property)) throw new Error(`${source.fileName}: unsupported locale property in ${name}`);
    entries[literal(property.name, source)] = literal(unwrap(property.initializer), source);
  }
  return entries;
}

// Parse the actual exported tables, including multiline strings and escaped text.
// Fail on new syntax rather than silently omitting a label from the shipped help.
function localeEntries(source) {
  const exported = source.statements.find((statement) => ts.isExportAssignment(statement));
  if (!exported) throw new Error(`${source.fileName}: missing default export`);
  let value = unwrap(exported.expression);
  if (ts.isIdentifier(value)) value = initializer(source, value.text);
  if (!ts.isObjectLiteralExpression(value)) throw new Error(`${source.fileName}: expected a locale object`);
  const entries = {};
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      const expression = property.expression;
      // 🟡 LAWOSS: domain dictionaries (apps/app/src/lawoss/i18n/*) are spread into sk/cs/en/de.
      if (ts.isIdentifier(expression)) {
        Object.assign(entries, importedLocaleTable(source, expression.text));
        continue;
      }
      if (!ts.isPropertyAccessExpression(expression) || expression.expression.getText() !== "projectTemplateStrings") {
        throw new Error(`${source.fileName}: unsupported locale spread ${expression.getText()}`);
      }
      const shared = parse("packages/types/src/project-template-strings.ts");
      const tables = initializer(shared, "projectTemplateStrings");
      if (!ts.isObjectLiteralExpression(tables)) throw new Error("Expected static project template translations");
      const table = tables.properties.find((entry) => ts.isPropertyAssignment(entry) && (ts.isStringLiteral(entry.name) || ts.isIdentifier(entry.name)) && entry.name.text === expression.name.text);
      if (!table || !ts.isObjectLiteralExpression(table.initializer)) throw new Error(`Missing template translations: ${expression.name.text}`);
      for (const entry of table.initializer.properties) {
        if (!ts.isPropertyAssignment(entry)) throw new Error("Unsupported template translation property");
        entries[literal(entry.name, shared)] = literal(unwrap(entry.initializer), shared);
      }
      continue;
    }
    if (!ts.isPropertyAssignment(property)) throw new Error(`${source.fileName}: unsupported locale property`);
    entries[literal(property.name, source)] = literal(unwrap(property.initializer), source);
  }
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b, "en")));
}

export function generateHelpI18n() {
  const runtime = parse("apps/app/src/i18n/index.ts");
  const languages = initializer(runtime, "LANGUAGES");
  if (!ts.isArrayLiteralExpression(languages)) throw new Error("LANGUAGES must be a static array");
  const shippedLocales = languages.elements.map((element) => literal(element, runtime));
  const locales = {};
  for (const file of readdirSync(join(repoRoot, localeDirectory)).filter((file) => file.endsWith(".ts") && file !== "index.ts").sort()) {
    const code = file.slice(0, -3);
    const source = `${localeDirectory}/${file}`;
    const entries = localeEntries(parse(source));
    locales[code] = {
      shipped: shippedLocales.includes(code),
      source,
      sha256: createHash("sha256").update(readNormalizedText(join(repoRoot, source))).digest("hex"),
      entryCount: Object.keys(entries).length,
      entries,
    };
  }
  for (const code of shippedLocales) {
    if (!locales[code]) throw new Error(`No translation file for shipped language ${code}`);
  }
  return JSON.stringify({
    schemaVersion: 1,
    generatedBy: "scripts/gen-core-skills.mjs",
    sourceLocale: "en",
    shippedLocales,
    note: "Exact UI strings, including buttons, menus, errors, placeholders and plural forms. Unshipped locale tables are incomplete archival translations, not selectable app languages. Missing entries are not translated by this generator.",
    locales,
  }, null, 2) + "\n";
}

export function helpDocFiles() {
  return readdirSync(join(repoRoot, "docs/user-guide"))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => ({
      path: `.opencode/skills/legalwork-help/references/${file}`,
      content: readNormalizedText(join(repoRoot, "docs/user-guide", file)),
    }));
}
