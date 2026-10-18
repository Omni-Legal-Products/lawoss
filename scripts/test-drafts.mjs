import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Test the TypeScript source directly on the repository's Node 24 runtime.
// Server imports use emitted .js names; resolve those to source during tests.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const target = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(target))) {
        const source = new URL(specifier.endsWith(".js") ? specifier.slice(0, -3) + ".ts" : specifier + ".ts", context.parentURL);
        if (existsSync(fileURLToPath(source))) return nextResolve(source.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

for (const path of [
  "../apps/server/src/email-drafts/eml.test.ts",
  "../apps/server/src/email-drafts/store.test.ts",
  "../apps/server/src/calendar-event-drafts/ics.test.ts",
  "../apps/app/tests/email-draft-links.test.ts",
  "../apps/app/tests/calendar-event-draft-links.test.ts",
]) await import(new URL(path, import.meta.url).href);
