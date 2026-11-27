/**
 * LAWOSS: hlásenie chyby alebo nápadu priamo z appky (špecifikácia „Systém verejnej alfy“, časť 2, 27. 11. 2026).
 *
 * Renderer len zbiera text formulára. Hlavný proces:
 *   - odfotí okno (len keď tester snímku zaškrtne),
 *   - zozbiera diagnostiku z existujúceho exportu (`collectTechnicalSupportBundle`, bez servera `buildSupportBundleText`),
 *   - odstráni z nej tajomstvá, e-maily a cesty k priečinkom klientov,
 *   - náhľad ukáže presne tie bajty, ktoré potom odošle na `POST /api/alfa/hlasenie` (multipart, `source=app`).
 * Údaje sú v pamäti len kým je okno otvorené; po odoslaní alebo zatvorení sa zahodia.
 * Obsah formulára ani kontakt sa nikde nelogujú (main.log ide do ďalšieho balíka).
 */
import { scrubSecrets } from "./support-bundle.mjs";
import { alphaPlatform, siteLocale } from "./lawoss-alpha-feedback.mjs";

export const DEFAULT_REPORT_ENDPOINT = "https://lawoss.app/api/alfa/hlasenie";
/** Server prijme diagnostiku do 10 MB; necháme rezervu na hlavičky multipartu. */
export const MAX_DIAGNOSTICS_BYTES = 9 * 1024 * 1024;
export const REPORT_TIMEOUT_MS = 45_000;
/** Náhľad v okne: celý balík by renderer zbytočne držal v pamäti. */
export const PREVIEW_CHARS = 200_000;

const KINDS = new Set(["chyba", "vylepsenie", "otazka"]);
const SEVERITIES = new Set(["blokuje", "vazne", "drobnost"]);
const REPEATS = new Set(["vzdy", "niekedy", "raz", "neskusane"]);
/** Kódy, ktoré vracia `site/src/app/api/alfa/hlasenie/route.ts`; renderer ku každému ukáže vetu. */
const SERVER_CODES = new Set(["rate_limited", "too_large", "consent", "invalid", "file_type", "too_many_files", "storage_failed", "bad_request"]);

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Adresa servera; `LAWOSS_ALPHA_REPORT_URL` len na lokálny test (https, alebo http na tomto počítači). */
export function reportEndpoint(env = process.env) {
  const raw = String(env.LAWOSS_ALPHA_REPORT_URL ?? "").trim();
  if (!raw) return DEFAULT_REPORT_ENDPOINT;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname))) return url.toString();
  } catch { /* neplatná adresa: ostáva produkčná */ }
  return DEFAULT_REPORT_ENDPOINT;
}

// ---------------------------------------------------------------------------
// Redakcia diagnostiky
// ---------------------------------------------------------------------------

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tokeny so známym tvarom, aj bez mena premennej pred nimi. */
const TOKEN_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-(?:[a-z]+-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
const SECRET_KEY = /(token|password|passwd|secret|credential|authorization|api[-_]?key|apikey|cookie|private[-_]?key|access[-_]?key)/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Koniec cesty: úvodzovka, koniec riadku, alebo bežný oddeľovač za ňou v logu („: “, „, “, „)“).
const PATH_END = String.raw`(?=["'\n\r]|: |, |\)|$)`;
// Len systémové priečinky aplikácií; `~/Library/CloudStorage` (Google Drive, OneDrive, Dropbox) a `Mobile Documents` (iCloud) nie.
const PROFILE_UNDER_HOME = String.raw`(?:Library[\\/](?:Application Support|Caches|Logs|Preferences)|\.config|\.local|\.cache|AppData[\\/](?:Local|Roaming))`;
const RESIDUAL_PATHS = [
  // Zvyšné cesty v domovskom priečinku mimo profilu appky.
  new RegExp(String.raw`~(?:[\\/]+|\\\\)(?!${PROFILE_UNDER_HOME}[\\/])[^"'\n\r]*?${PATH_END}`, "gm"),
  // Externé disky a sieťové úložiská (často priečinky kancelárie).
  new RegExp(String.raw`(?:/Volumes|/media|/mnt)/[^"'\n\r]*?${PATH_END}`, "gm"),
  new RegExp(String.raw`\\{2,4}[A-Za-z0-9._$-]+\\{1,2}[^"'\n\r]*?${PATH_END}`, "gm"),
  // Iné disky Windows; systémové priečinky ostávajú čitateľné.
  new RegExp(String.raw`\b[A-Za-z]:(?:\\\\|\\|/)(?!(?:Windows|Program Files|Program Files \(x86\))(?:\\|/))[^"'\n\r]*?${PATH_END}`, "gm"),
];

/** Varianty zápisu cesty: ako je, s lomkami, a so zdvojenými spätnými lomkami (v JSON). */
function pathVariants(value) {
  const raw = String(value ?? "").replace(/[\\/]+$/, "");
  if (raw.length < 2) return [];
  const forward = raw.replace(/\\/g, "/");
  const backward = raw.replace(/\//g, "\\");
  return [...new Set([raw, forward, backward, backward.replace(/\\/g, "\\\\")])];
}

/** Prípona súboru zo zvyšnej cesty, aby bolo vidieť aspoň typ dokumentu. */
const pathPlaceholder = (match) => `<path>${/\.[A-Za-z0-9]{1,5}$/.exec(match)?.[0] ?? ""}`;

/**
 * Pravidlá redakcie pre tento počítač. `clientRoots` sú priečinky klientov (a kancelárie), `profile` priečinky appky,
 * `clientNames` názvy priečinkov klientov, ktoré sa odstránia aj mimo cesty (napr. v správe v logu).
 * @param {{ home?: string, clientRoots?: string[], clientNames?: string[], profile?: Array<[string, string]> }} options
 */
export function createRedactor({ home = "", clientRoots = [], clientNames = [], profile = [] } = {}) {
  /** @type {Array<[string, string, boolean]>} */
  const prefixes = [];
  for (const [dir, label] of profile) for (const variant of pathVariants(dir)) prefixes.push([variant, label, false]);
  // V priečinku klienta sú aj mená súborov údajmi klienta: ostane len prípona.
  for (const root of clientRoots) for (const variant of pathVariants(root)) prefixes.push([variant, "<client-folder>", true]);
  for (const variant of pathVariants(home)) prefixes.push([variant, "~", false]);
  // Najdlhšia cesta prvá: profil a klient sú vnútri domovského priečinka.
  prefixes.sort((a, b) => b[0].length - a[0].length);
  /** @type {Array<[RegExp, (match: string) => string]>} */
  const rules = prefixes.map(([variant, label, whole]) => whole
    ? [new RegExp(String.raw`${escapeRegExp(variant)}(?:[\\/][^"'\n\r]*?)?${PATH_END}`, "gim"), (match) => match.length > variant.length ? `${label}/${pathPlaceholder(match)}` : label]
    : [new RegExp(String.raw`${escapeRegExp(variant)}(?=[\\/"'\s:,)]|$)`, "gim"), () => label]);

  // Názvy kratšie ako 3 znaky by zasiahli bežné slová.
  const names = [...new Set(clientNames.map((name) => String(name ?? "").trim()).filter((name) => name.length >= 3))]
    .sort((a, b) => b.length - a.length)
    .map((name) => new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(name)}(?![\p{L}\p{N}])`, "giu"));

  /** @param {string} text */
  const redactText = (text) => {
    let value = scrubSecrets(text);
    for (const pattern of TOKEN_PATTERNS) value = value.replace(pattern, "<redacted>");
    value = value
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@"']+:[^/\s@"']+@/gi, "$1<redacted>@")
      .replace(/([?&](?:token|key|api_key|apikey|access_token|refresh_token|code|sig|signature|secret|password|auth)=)[^&\s"'#]+/gi, "$1<redacted>")
      .replace(EMAIL, "<email>");
    for (const [pattern, label] of rules) value = value.replace(pattern, label);
    for (const pattern of RESIDUAL_PATHS) value = value.replace(pattern, pathPlaceholder);
    for (const pattern of names) value = value.replace(pattern, "<client>");
    return value;
  };

  /** JSON sa redaguje po hodnotách, aby výsledok ostal platný JSON (aj kľúče môžu byť cesty). */
  const redactJson = (value, key = "") => {
    if (typeof value === "string") return SECRET_KEY.test(key) && value ? "<redacted>" : redactText(value);
    if (Array.isArray(value)) return value.map((item) => redactJson(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [redactText(name), redactJson(item, name)]));
    }
    return value;
  };

  return { redactText, redactJson };
}

/** Ponechá najnovší koniec textu do `limit` bajtov UTF-8. */
export function keepUtf8Tail(text, limit) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  const marker = "…(skrátené, ostal najnovší koniec)…\n";
  const tail = bytes.subarray(bytes.length - (limit - Buffer.byteLength(marker))).toString("utf8").replace(/^�+/, "");
  return marker + tail;
}

/**
 * Diagnostika pre hlásenie. Technický export (JSON) potrebuje bežiaci lokálny server; na chybovej obrazovke
 * pri štarte server nebeží, preto sa použije textový balík podpory.
 * @param {{ collectTechnical: () => Promise<string>, collectBasic: () => Promise<string>, redactor: ReturnType<typeof createRedactor>, limit?: number }} options
 */
export async function collectReportDiagnostics({ collectTechnical, collectBasic, redactor, limit = MAX_DIAGNOSTICS_BYTES }) {
  let content = "";
  let json = false;
  try {
    const parsed = JSON.parse(await collectTechnical());
    content = JSON.stringify(redactor.redactJson(parsed), null, 2);
    json = true;
  } catch {
    content = redactor.redactText(await collectBasic());
  }
  if (Buffer.byteLength(content, "utf8") > limit) {
    // Skrátený JSON by nebol platný; pošle sa ako text s najnovším koncom.
    content = keepUtf8Tail(content, limit);
    json = false;
  }
  return json
    ? { name: "lawoss-diagnostika.json", type: "application/json", content }
    : { name: "lawoss-diagnostika.txt", type: "text/plain", content };
}

// ---------------------------------------------------------------------------
// Formulár a odoslanie
// ---------------------------------------------------------------------------

const clean = (value, max) => String(value ?? "").trim().slice(0, max);

/** Polia z renderera zúžené na hodnoty, ktoré server pozná. */
export function normalizeReportFields(input = {}) {
  const kind = KINDS.has(input.kind) ? input.kind : "chyba";
  return {
    kind,
    severity: kind === "chyba" ? (SEVERITIES.has(input.severity) ? input.severity : "vazne") : "",
    what: clean(input.what, 6000),
    outcome: clean(input.outcome, 6000),
    repeat: REPEATS.has(input.repeat) ? input.repeat : "",
    contact: clean(input.contact, 254),
  };
}

/** Kontrola pred odoslaním; rovnaké minimum ako server (popis aspoň 5 znakov). */
export function reportFieldsError(fields) {
  return fields.what.length < 5 ? "invalid" : "";
}

/**
 * Multipart podľa tabuľky „Spoločné rozhranie“. Pole `website` (pasca na roboty) appka nikdy neposiela.
 * @param {{ fields: ReturnType<typeof normalizeReportFields>, version: string, locale: string, platform?: NodeJS.Platform, arch?: NodeJS.Architecture,
 *   invite?: string, diagnostics?: { name: string, type: string, content: string } | null, screenshot?: Buffer | null }} input
 */
export function buildReportForm({ fields, version, locale, platform = process.platform, arch = process.arch, invite = "", diagnostics = null, screenshot = null }) {
  const form = new FormData();
  form.set("source", "app");
  form.set("kind", fields.kind);
  if (fields.kind === "chyba") form.set("severity", fields.severity);
  form.set("os", alphaPlatform(platform, arch) || "ine");
  form.set("version", clean(version, 60));
  form.set("locale", siteLocale(locale));
  form.set("what", fields.what);
  form.set("outcome", fields.outcome);
  if (fields.repeat) form.set("repeat", fields.repeat);
  if (fields.contact) form.set("contact", fields.contact);
  if (invite) form.set("invite", clean(invite, 200));
  form.set("consent", "on");
  if (diagnostics) form.set("diagnostics", new Blob([diagnostics.content], { type: diagnostics.type }), diagnostics.name);
  if (screenshot?.length) form.append("files", new Blob([new Uint8Array(screenshot)], { type: "image/png" }), "snimka-okna.png");
  return form;
}

/**
 * Odošle hlásenie s časovým limitom. Vráti `{ ok: true, id }` alebo `{ ok: false, code }`; nikdy nehádže
 * a nevracia text odpovede servera.
 * @param {{ endpoint: string, form: FormData, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<{ ok: true, id: number } | { ok: false, code: string }>}
 */
export async function submitReport({ endpoint, form, fetchImpl = fetch, timeoutMs = REPORT_TIMEOUT_MS }) {
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      body: form,
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    if (response.ok && body?.ok === true) return { ok: true, id: Number.isSafeInteger(Number(body.id)) ? Number(body.id) : 0 };
    const error = typeof body?.error === "string" ? body.error : "";
    if (SERVER_CODES.has(error)) return { ok: false, code: error };
    if (response.status === 429) return { ok: false, code: "rate_limited" };
    if (response.status === 413) return { ok: false, code: "too_large" };
    return { ok: false, code: response.status >= 500 ? "server" : "unknown" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

/** Obsah lokálne uloženého balíka (keď odoslanie zlyhá); snímka sa uloží vedľa ako PNG. */
export function localReportBundle({ fields, version, locale, platform = process.platform, arch = process.arch, diagnostics = null, screenshotName = "" }) {
  return JSON.stringify({
    format: "lawoss-alpha-report",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    source: "app",
    version: clean(version, 60),
    os: alphaPlatform(platform, arch) || "ine",
    locale: siteLocale(locale),
    ...fields,
    screenshot: screenshotName || null,
    diagnostics: diagnostics ? { name: diagnostics.name, content: diagnostics.content } : null,
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Relácia jedného okna hlásenia
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   captureWindow: (sender: unknown) => Promise<{ png: Buffer, preview: string } | null>,
 *   collectDiagnostics: () => Promise<{ name: string, type: string, content: string }>,
 *   context: () => { version: string, locale: string, invite?: string },
 *   endpoint?: () => string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   saveFiles?: (files: { bundle: string, screenshot: Buffer | null }) => Promise<string | null>,
 * }} deps
 */
export function createAlphaReportSession(deps) {
  let state = { id: 0, screenshot: /** @type {Buffer | null} */ (null), diagnostics: /** @type {Promise<{ name: string, type: string, content: string }> | null} */ (null) };
  let nextId = 1;
  const endpoint = deps.endpoint ?? (() => reportEndpoint());

  const current = (id) => {
    if (!id || id !== state.id) throw new Error("The report window was closed. Open it again.");
    return state;
  };
  const diagnostics = (id) => {
    const session = current(id);
    session.diagnostics ??= deps.collectDiagnostics();
    // Neúspešný zber sa dá skúsiť znova.
    session.diagnostics.catch(() => { if (state === session) session.diagnostics = null; });
    return session.diagnostics;
  };

  return {
    /** Nové okno: snímka sa robí ešte pred zobrazením okna hlásenia, aby na nej nebolo. */
    async prepare(sender) {
      const shot = await deps.captureWindow(sender).catch(() => null);
      state = { id: nextId++, screenshot: shot?.png ?? null, diagnostics: null };
      const url = new URL(endpoint());
      return { id: state.id, screenshot: shot?.preview ?? null, server: url.host };
    },
    async preview(id) {
      const result = await diagnostics(id);
      const bytes = Buffer.byteLength(result.content, "utf8");
      return { name: result.name, bytes, text: result.content.slice(0, PREVIEW_CHARS), truncated: result.content.length > PREVIEW_CHARS };
    },
    /** @returns {Promise<{ ok: true, id: number } | { ok: false, code: string }>} */
    async submit(id, input) {
      const session = current(id);
      const fields = normalizeReportFields(input);
      const invalid = reportFieldsError(fields);
      if (invalid) return { ok: false, code: invalid };
      let attached = null;
      if (input?.includeDiagnostics) {
        try { attached = await diagnostics(id); } catch { return { ok: false, code: "diagnostics" }; }
      }
      const { version, locale, invite = "" } = deps.context();
      const form = buildReportForm({ fields, version, locale, invite, diagnostics: attached, screenshot: input?.includeScreenshot ? session.screenshot : null });
      const result = await submitReport({ endpoint: endpoint(), form, fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs });
      if (result.ok && state === session) state = { id: 0, screenshot: null, diagnostics: null };
      return result;
    },
    async save(id, input) {
      const session = current(id);
      if (!deps.saveFiles) return { path: null };
      const fields = normalizeReportFields(input);
      let attached = null;
      if (input?.includeDiagnostics) attached = await diagnostics(id).catch(() => null);
      const { version, locale } = deps.context();
      const screenshot = input?.includeScreenshot ? session.screenshot : null;
      const bundle = localReportBundle({ fields, version, locale, diagnostics: attached, screenshotName: screenshot ? "snimka-okna.png" : "" });
      return { path: await deps.saveFiles({ bundle, screenshot }) };
    },
    /** @returns {{ ok: true }} */
    discard(id) {
      if (!id || id === state.id) state = { id: 0, screenshot: null, diagnostics: null };
      return { ok: true };
    },
  };
}
