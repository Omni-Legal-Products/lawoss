import { afterEach, expect, test } from "bun:test";
import type { ProjectTemplateCatalog } from "@legalwork/types/workspace";
import { createLegalworkServerClient, LegalworkServerError } from "../src/app/lib/legalwork-server";
import { loadProjectTemplateCatalog } from "../src/react-app/domains/workspace/project-template-catalog";
import { defaultProjectTemplates, migrateProjectDefaults, useProjectDefaultsStore } from "../src/react-app/domains/workspace/project-defaults-store";

const initial = useProjectDefaultsStore.getState();
afterEach(() => useProjectDefaultsStore.setState(initial));
const emptyServer = (): ProjectTemplateCatalog => ({ revision: 0, templates: defaultProjectTemplates(), defaultTemplateId: "legal_matter" });

test("legacy defaults, including explicitly empty fields, are imported once and available to another client", async () => {
  let server = emptyServer();
  let writes = 0;
  const client = {
    ...createLegalworkServerClient({ baseUrl: "http://example.test" }),
    getProjectTemplates: async () => structuredClone(server),
    saveProjectTemplates: async (catalog: ProjectTemplateCatalog) => { writes++; server = { ...structuredClone(catalog), revision: 1 }; return server; },
  };
  useProjectDefaultsStore.setState({ ...migrateProjectDefaults({ fields: [] }), migrated: false });
  const imported = await loadProjectTemplateCatalog(client);
  expect(imported.templates[0].fields).toEqual([]);
  expect(imported.templates).toHaveLength(4);
  expect(imported.revision).toBe(1);
  expect(await loadProjectTemplateCatalog(client)).toEqual(imported);
  expect(writes).toBe(1);
});

test("fresh installs only read; a configured server takes precedence over the browser's old catalog", async () => {
  const server = { ...emptyServer(), revision: 5, defaultTemplateId: null, templates: [] };
  const client = {
    ...createLegalworkServerClient({ baseUrl: "http://example.test" }),
    getProjectTemplates: async () => server,
    saveProjectTemplates: async () => { throw new Error("Must not overwrite server templates"); },
  };
  useProjectDefaultsStore.setState({ ...migrateProjectDefaults({ fields: [] }), migrated: false });
  expect(await loadProjectTemplateCatalog(client)).toEqual(server);
  useProjectDefaultsStore.setState({ migrated: false, hasLegacyDefaults: false });
  expect(await loadProjectTemplateCatalog({ ...client, getProjectTemplates: async () => emptyServer() })).toEqual(emptyServer());
});

test("a concurrent migration reloads the winning catalog instead of overwriting it", async () => {
  let server = emptyServer();
  const winner = { ...emptyServer(), revision: 1, defaultTemplateId: null, templates: [] };
  const client = {
    ...createLegalworkServerClient({ baseUrl: "http://example.test" }),
    getProjectTemplates: async () => server,
    saveProjectTemplates: async () => { server = winner; throw new LegalworkServerError(409, "project_templates_conflict", "Changed"); },
  };
  useProjectDefaultsStore.setState({ ...migrateProjectDefaults({ fields: [] }), migrated: false });
  expect(await loadProjectTemplateCatalog(client)).toEqual(winner);
  expect(useProjectDefaultsStore.getState().migrated).toBe(true);
});
