/**
 * Long-cacheable bootstrap shell for the Office task pane.
 *
 * Word's SourceLocation URL (taskpane.html) serves THIS page with a
 * one-year max-age, so the Office webview can render it from its HTTP
 * cache even while the LegalWork server is down — instead of Office's
 * uncustomizable "Add-in Error" page. The shell has exactly two jobs:
 *
 *   1. Server reachable  -> refresh its own cache entry, then hand off to
 *      /word-addin/app.html (the real pane, served no-store as always).
 *   2. Server down       -> show "LegalWork is not running" with an
 *      Open LegalWork button (legalwork:// deep link) and poll until the
 *      server appears, then hand off automatically.
 *
 * Updates: app updates never require a shell change (the shell only
 * forwards). Shell updates use immutable versioned URLs, because that is
 * the only mechanism navigation caches honor reliably (verified in
 * Chromium: neither subresource fetches with cache:"reload" nor
 * location.reload() dependably replace the entry a future navigation
 * renders):
 *
 *   - taskpane.html?pairing=2 (the manifest URL) serves a tiny redirector,
 *     cached for 30 days. It preserves the installation capability fragment
 *     and only selects a pairing-capable shell. The versioned query avoids
 *     legacy redirectors that discarded the capability.
 *   - shell-v<N>.html serves the actual shell, cached immutable. When a
 *     running shell learns from the bootstrap response that a newer
 *     version exists, it records it and NAVIGATES to the new URL while
 *     online — seeding the navigation cache for future offline opens.
 *
 * Keep this file dependency-free and the HTML self-contained: it must
 * render offline with nothing but itself.
 */

/**
 * BUMP THIS whenever anything in the shell HTML below changes (markup,
 * styles, copy, or script). Each version is served at its own immutable
 * URL (shell-v<N>.html); running shells learn the current version from
 * the bootstrap response and navigate to the new URL while online.
 * Without a bump, existing installs keep rendering the old shell for up
 * to a year. Increment the number.
 */
export const WORD_ADDIN_SHELL_VERSION = "7";

export const OFFICE_SHELL_COPY = {
  "en": {
    "connecting": "Connecting to LAWOSS…",
    "offlineTitle": "LAWOSS is not running",
    "offlineBody": "Start LAWOSS to use the add-in. This pane connects automatically when it is running.",
    "open": "Open LAWOSS",
    "retry": "Try again",
    "pairingTitle": "Reopen the Office add-in",
    "pairingBody": "Close and reopen this pane. If it still cannot connect, reinstall it in LAWOSS Office Add-ins settings."
  },
  "cs": {
    "connecting": "Připojuji k LAWOSS…",
    "offlineTitle": "LAWOSS není spuštěný",
    "offlineBody": "Spusťte LAWOSS, abyste mohli používat doplněk. Panel se potom připojí automaticky.",
    "open": "Otevřít LAWOSS",
    "retry": "Zkusit znovu",
    "pairingTitle": "Otevřete doplněk Office znovu",
    "pairingBody": "Zavřete a znovu otevřete tento panel. Pokud se nepřipojí, přeinstalujte jej v nastavení Doplňky Office v LAWOSS."
  },
  "sk": {
    "connecting": "Pripájam k LAWOSS…",
    "offlineTitle": "LAWOSS nie je spustený",
    "offlineBody": "Spustite LAWOSS, aby ste mohli používať doplnok. Panel sa potom pripojí automaticky.",
    "open": "Otvoriť LAWOSS",
    "retry": "Skúsiť znova",
    "pairingTitle": "Otvorte doplnok Office znova",
    "pairingBody": "Zatvorte a znova otvorte tento panel. Ak sa nepripojí, preinštalujte ho v nastaveniach Doplnky Office v LAWOSS."
  },
  "de": {
    "connecting": "Verbindung zu LAWOSS…",
    "offlineTitle": "LAWOSS ist nicht geöffnet",
    "offlineBody": "Starten Sie LAWOSS, um das Add-in zu verwenden. Dieser Bereich verbindet sich dann automatisch.",
    "open": "LAWOSS öffnen",
    "retry": "Erneut versuchen",
    "pairingTitle": "Office-Add-in erneut öffnen",
    "pairingBody": "Schließen und öffnen Sie diesen Bereich erneut. Falls die Verbindung weiterhin fehlschlägt, installieren Sie ihn in den Office-Add-in-Einstellungen von LAWOSS erneut."
  }
};

export function buildWordAddinShellHtml(): string {
  return `<!doctype html>
<!-- LegalWork task pane shell v${WORD_ADDIN_SHELL_VERSION} -->
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LAWOSS</title>
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" defer onerror="this.remove()"></script>
<style>
  /* Colors are the pane theme's computed dls tokens (deployment "web"),
     baked in so the offline screen matches the app's connect screen:
     surface #fffffff7, text #0e0a07, secondary #0e0a078c, border
     #0e0a0714, hover #0e0a070a, accent #18498b / hover #2352de. */
  :root { color-scheme: light; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #fffffff7; color: #0e0a07;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    text-align: center;
  }
  .box { max-width: 300px; padding: 24px; }
  .title { font-size: 14px; font-weight: 500; margin: 0 0 12px; color: #0e0a07; }
  .body { font-size: 12px; line-height: 1.6; color: #0e0a078c; margin: 0 0 16px; }
  .row { display: flex; gap: 8px; justify-content: center; }
  button {
    font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
    border-radius: 999px; padding: 6px 16px; transition: background-color 120ms, color 120ms;
  }
  .primary { background: #18498b; color: #fefefe; border: 1px solid #18498b; }
  .primary:hover { background: #2352de; border-color: #2352de; }
  .ghost { background: #fffffff7; color: #0e0a07; border: 1px solid #0e0a0714; }
  .ghost:hover { background: #0e0a070a; }
  .spinner {
    width: 18px; height: 18px; margin: 0 auto 12px;
    border: 2px solid #0e0a0714; border-top-color: #18498b; border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hidden { display: none; }
  .ver { font-size: 10px; color: #0e0a0740; margin: 14px 0 0; }
</style>
</head>
<body>
  <div class="box" id="connecting">
    <div class="spinner"></div>
    <p class="body" id="connecting-text"></p>
  </div>
  <div class="box hidden" id="offline">
    <p class="title" id="offline-title"></p>
    <p class="body" id="offline-body"></p>
    <div class="row">
      <button type="button" class="primary" id="open-btn"></button>
      <button type="button" class="ghost" id="retry-btn"></button>
    </div>
    <p class="ver">v${WORD_ADDIN_SHELL_VERSION}</p>
  </div>
<script>
(async function () {
  "use strict";
  var translations = ${JSON.stringify(OFFICE_SHELL_COPY)};
  var currentCopy = translations.en;
  function supported(value) { return typeof value === "string" && Object.prototype.hasOwnProperty.call(translations, value); }
  function systemLanguage() {
    var tags = typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : [];
    for (var i = 0; i < tags.length; i++) { var language = String(tags[i]).toLowerCase().split("-")[0]; if (supported(language)) return language; }
    return "en";
  }
  function applyLanguage(language) {
    currentCopy = translations[supported(language) ? language : systemLanguage()];
    if (document.documentElement) document.documentElement.lang = supported(language) ? language : systemLanguage();
    document.getElementById("connecting-text").textContent = currentCopy.connecting;
    document.getElementById("offline-title").textContent = currentCopy.offlineTitle;
    document.getElementById("offline-body").textContent = currentCopy.offlineBody;
    document.getElementById("open-btn").textContent = currentCopy.open;
    document.getElementById("retry-btn").textContent = currentCopy.retry;
  }

  var capability = "";
  try {
    capability = new URLSearchParams(location.hash.slice(1)).get("capability") || sessionStorage.getItem("legalwork.officeCapability") || "";
    if (capability) sessionStorage.setItem("legalwork.officeCapability", capability);
    if (location.hash.indexOf("capability=") !== -1) history.replaceState(null, "", location.pathname + location.search);
  } catch (e) { /* retain the manifest capability when storage is unavailable */ }
  try {
    if (capability && typeof crypto !== "undefined" && crypto.subtle) {
      var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability));
      var scope = Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
      var oldScope = localStorage.getItem("legalwork.officeLocaleScope");
      if (oldScope && oldScope !== scope) localStorage.removeItem("legalwork.language");
      localStorage.setItem("legalwork.officeLocaleScope", scope);
    }
  } catch (e) { /* Offline presentation remains available without storage. */ }
  var lang = "";
  try { lang = localStorage.getItem("legalwork.language") || ""; } catch (e) { /* use system */ }
  applyLanguage(supported(lang) ? lang : systemLanguage());
  function pairedUrl(path) { return path + (capability ? "#capability=" + encodeURIComponent(capability) : ""); }
  var SHELL_VERSION = "${WORD_ADDIN_SHELL_VERSION}";
  var handedOff = false;

  function checkServer() {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 3000) : null;
    return fetch("bootstrap", { headers: { "X-LegalWork-Office-Capability": capability }, cache: "no-store", signal: controller ? controller.signal : undefined })
      .then(function (response) { return response.ok ? response.json() : response.status === 401 ? { pairingRequired: true } : null; })
      .then(function (data) { return data && typeof data === "object" ? data : null; })
      .catch(function () { return null; })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function rememberVersion(version) {
    try { localStorage.setItem("legalwork.shellVersion", version); } catch (e) { /* ignore */ }
  }

  function handOff(bootstrap) {
    if (handedOff) return;
    if (bootstrap && bootstrap.pairingRequired) {
      try { localStorage.removeItem("legalwork.language"); localStorage.removeItem("legalwork.officeLocaleScope"); } catch (e) { /* presentation cache only */ }
      applyLanguage(systemLanguage());
      showOffline();
      document.getElementById("offline-title").textContent = currentCopy.pairingTitle;
      document.getElementById("offline-body").textContent = currentCopy.pairingBody;
      return;
    }
    if (bootstrap && supported(bootstrap.uiLocale)) {
      applyLanguage(bootstrap.uiLocale);
      try { localStorage.setItem("legalwork.language", bootstrap.uiLocale); } catch (e) { /* in-memory only */ }
    }
    handedOff = true;
    var current = bootstrap && bootstrap.shellVersion;
    if (typeof current === "string" && current && current !== SHELL_VERSION) {
      // Newer shell available: record it and navigate to its immutable
      // URL while the server is reachable, seeding the navigation cache
      // for future offline opens. The new shell hands off to the app.
      rememberVersion(current);
      location.replace(pairedUrl("shell-v" + encodeURIComponent(current) + ".html"));
      return;
    }
    rememberVersion(SHELL_VERSION);
    location.replace(pairedUrl("app.html"));
  }

  function showOffline() {
    document.getElementById("connecting").classList.add("hidden");
    document.getElementById("offline").classList.remove("hidden");
  }

  function openLegalwork() {
    var url = "legalwork://open";
    try {
      var office = window.Office;
      if (office && office.context && office.context.ui && office.context.ui.openBrowserWindow) {
        office.context.ui.openBrowserWindow(url);
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      var opened = window.open(url, "_blank");
      if (opened) return;
    } catch (e) { /* fall through */ }
    location.href = url;
  }

  document.getElementById("open-btn").addEventListener("click", openLegalwork);
  document.getElementById("retry-btn").addEventListener("click", function () {
    checkServer().then(function (data) { if (data) handOff(data); });
  });

  checkServer().then(function (data) {
    if (data) { handOff(data); return; }
    showOffline();
    var poll = setInterval(function () {
      checkServer().then(function (next) {
        if (next) { clearInterval(poll); handOff(next); }
      });
    }, 2500);
  });
})();
</script>
</body>
</html>
`;
}

/**
 * The manifest's redirector preserves pairing through navigation. The query
 * version in buildWordAddinManifest must change if the redirector's behavior
 * changes again, because Office may keep this page in its navigation cache.
 */
export function buildWordAddinRedirectorHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>LAWOSS</title>
</head>
<body>
<script>
(function () {
  "use strict";
  // pairing=2 on the installed manifest avoids pre-pairing redirector cache
  // entries. Never select a legacy cached shell that drops the capability.
  location.replace("shell-v${WORD_ADDIN_SHELL_VERSION}.html" + location.hash);
})();
</script>
</body>
</html>
`;
}
