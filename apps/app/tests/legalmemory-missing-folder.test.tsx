/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { createLegalworkServerClient, LegalworkServerError } from "../src/app/lib/legalwork-server";
import { currentLanguagePreference, setLanguagePreference, setLocale } from "../src/i18n";
import { LegalMemoryFilesPanel } from "../src/react-app/domains/session/panel/legalmemory-files-panel";

const client = createLegalworkServerClient({ baseUrl: "http://localhost:1" });
const rawMessage = "Reconnect the project drive or restore its folder to its original location, then retry.";

async function renderFailure(query: "storage-roots" | "legalmemory-tree-roots", error: Error, hasStorage = false) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false } } });
  try {
    const otherQuery = query === "storage-roots" ? "legalmemory-tree-roots" : "storage-roots";
    cache.setQueryData([otherQuery, "workspace", client.baseUrl], {
      roots: hasStorage ? [{ id: "s3", name: "Synthetic storage", kind: "s3", writable: false }] : [],
    });
    await cache.prefetchQuery({
      queryKey: [query, "workspace", client.baseUrl],
      queryFn: () => { throw error; },
    });
    return renderToStaticMarkup(
      <QueryClientProvider client={cache}>
        <LegalMemoryFilesPanel client={client} workspaceId="workspace" onOpenFile={() => {}} onOpenStorageFile={() => {}} />
      </QueryClientProvider>,
    );
  } finally { cache.clear(); }
}

const translations = {
  cs: { message: "Složka klienta není k dispozici. Znovu připojte její jednotku nebo obnovte složku do původního umístění a zkuste to znovu.", retry: "Zkusit znovu" },
  sk: { message: "Priečinok klienta nie je dostupný. Znova pripojte jeho disk alebo obnovte priečinok na pôvodnom mieste a skúste to znova.", retry: "Skúsiť znova" },
};

for (const locale of ["cs", "sk"] as const) {
  for (const query of ["storage-roots", "legalmemory-tree-roots"] as const) {
    test(`Memory Drive renders the typed missing-folder error and retry in ${locale} for ${query}`, async () => {
      const preference = currentLanguagePreference();
      try {
        setLocale(locale);
        const html = await renderFailure(query, new LegalworkServerError(404, "project_folder_unavailable", rawMessage));
        expect(html).toContain(translations[locale].message);
        expect(html).toContain(translations[locale].retry);
        expect(html).not.toContain(rawMessage);
      } finally { setLanguagePreference(preference); }
    });
  }
  test(`Memory Drive translates a missing LegalMemory folder alongside connected storage in ${locale}`, async () => {
    const preference = currentLanguagePreference();
    try {
      setLocale(locale);
      const html = await renderFailure("legalmemory-tree-roots", new LegalworkServerError(404, "project_folder_unavailable", rawMessage), true);
      expect(html).toContain(translations[locale].message);
      expect(html).not.toContain(rawMessage);
    } finally { setLanguagePreference(preference); }
  });
}

test("Memory Drive preserves an unrelated provider error and its retry action", async () => {
  const preference = currentLanguagePreference();
  try {
    setLocale("en");
    const message = "Synthetic provider connection needs attention.";
    const html = await renderFailure("storage-roots", new LegalworkServerError(502, "storage_provider_unavailable", message));
    expect(html).toContain(message);
    expect(html).toContain("Try again");
  } finally { setLanguagePreference(preference); }
});
