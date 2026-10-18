import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

// Packaged Electron ships emitted JavaScript, not the shared TypeScript package.
// Do not use the source resolver from test-drafts.mjs for this smoke test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@legalwork/types")) {
      throw new Error(`Unbundled workspace dependency: ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
});

test("built email and event routes load in Node without workspace TypeScript", async () => {
  const email = await import("../apps/server/dist/routes/email-drafts.js");
  const calendar = await import("../apps/server/dist/routes/calendar-event-drafts.js");
  const connectors = await import("../apps/server/dist/routes/connectors.js");
  const actions = await import("../apps/server/dist/connectors/index.js");
  assert.equal(typeof email.registerEmailDraftRoutes, "function");
  assert.equal(typeof calendar.registerCalendarEventDraftRoutes, "function");
  assert.equal(typeof connectors.registerConnectorRoutes, "function");
  assert.ok(actions.CONNECTOR_EXTENSION_ACTIONS.some(action => action.extensionId === "gmail" && action.action === "send_draft"));
});
