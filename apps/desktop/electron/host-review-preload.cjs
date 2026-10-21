// Dedicated isolated world: no contextBridge or application API is exposed.
const { ipcRenderer } = require("electron");
const reviewId = process.argv.find(arg => arg.startsWith("--lawoss-review-id="))?.slice("--lawoss-review-id=".length);
document.addEventListener("DOMContentLoaded", () => {
  const deny = document.getElementById("deny"), allow = document.getElementById("allow");
  let initialized = false, answered = false;
  const applyLocale = ui => {
    if (!ui || typeof ui !== "object") return;
    if (document.documentElement && ["en", "de", "cs", "sk"].includes(ui.locale)) document.documentElement.lang = ui.locale;
    for (const [id, key] of [["deny", "deny"], ["allow", "allow"], ["review-note", "note"], ["heading", "title"], ["message", "message"]]) {
      if (typeof ui[key] === "string") { const element = document.getElementById(id); if (element) element.textContent = ui[key]; }
    }
    if (typeof ui.context === "string") document.getElementById("context").setAttribute?.("aria-label", ui.context);
  };
  ipcRenderer.on("lawoss:host-review:locale", (_event, payload) => {
    if (initialized && !answered && payload?.reviewId === reviewId) applyLocale(payload.ui);
  });
  const answer = decision => {
    if (!initialized || answered) return;
    answered = true; deny.disabled = true; allow.disabled = true;
    ipcRenderer.send("lawoss:host-review:decision", reviewId, decision);
  };
  deny.addEventListener("click", () => answer("deny"));
  allow.addEventListener("click", () => answer("allow"));
  ipcRenderer.on("lawoss:host-review:payload", (_event, payload) => {
    if (initialized || !reviewId || payload?.reviewId !== reviewId || typeof payload.detail !== "string") return;
    initialized = true;
    document.getElementById("heading").textContent = payload.title;
    document.getElementById("message").textContent = payload.message;
    document.getElementById("context").textContent = payload.detail;
    applyLocale(payload.ui);
    deny.disabled = false; allow.disabled = false; deny.focus();
  });
  if (reviewId) ipcRenderer.send("lawoss:host-review:ready", reviewId);
});
