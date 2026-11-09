// LAWOSS v2: testy desktopu bez enginu (job unit-tests, Windows source tests) nemajú
// vygenerovaný výber derivátu `packages/opencode-release/generated/selection.json`,
// ktorý `runtime.mjs` načíta pri importe. Lokálne zase výber pinuje skutočný derivát
// a neprijme syntetický engine. Tento proces preto dostane vlastnú knižnicu vydania
// s oficiálnym výberom, rovnako ako upstream fixture `writeFixtureReleaseLibrary`.
// Volaj pred dynamickým importom `runtime.mjs`; statický import by výber načítal skôr.
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFixtureReleaseLibrary } from "../../packages/opencode-release/test-fixture.mjs";

const releasePackage = "@legalwork/opencode-release";

/** Presmeruje `@legalwork/opencode-release` v tomto procese na oficiálnu fixture knižnicu. */
export async function useOfficialEngineSelection() {
  const library = await mkdtemp(path.join(os.tmpdir(), "lawoss-official-engine-selection-"));
  await writeFixtureReleaseLibrary(library);
  const exported = JSON.parse(readFileSync(path.join(library, "package.json"), "utf8")).exports;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== releasePackage && !specifier.startsWith(`${releasePackage}/`)) return nextResolve(specifier, context);
      const entry = exported[`.${specifier.slice(releasePackage.length)}`];
      if (!entry) return nextResolve(specifier, context);
      return { url: pathToFileURL(path.join(library, typeof entry === "string" ? entry : entry.import)).href, shortCircuit: true };
    },
  });
  return async () => {
    hooks.deregister();
    await rm(library, { recursive: true, force: true });
  };
}
