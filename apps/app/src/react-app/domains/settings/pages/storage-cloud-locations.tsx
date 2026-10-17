/** @jsxImportSource react */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

/** Provider discovery happens only after the user asks to choose a drive/library. */
export function StorageCloudLocations({ client, provider, accountId, onSelect }: {
  client: LegalworkServerClient; provider: string; accountId: string; onSelect: (id: string) => void;
}) {
  const [locations, setLocations] = useState<{ id: string; name: string; site: boolean }[] | null>(null);
  const [siteId, setSiteId] = useState<string | undefined>();
  const [next, setNext] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async (site?: string, pageToken?: string) => {
    setBusy(true); setError("");
    try {
      const kind = provider === "sharepoint-files" && !site ? "sites" : "drives";
      const result = await client.connectorStorageLocations(provider, accountId, kind, { ...(site ? { siteId: site } : {}), ...(pageToken ? { pageToken } : {}) });
      setSiteId(site); setNext(result.nextPageToken);
      const values = kind === "sites" ? (result.sites ?? []).map((item) => ({ id: item.id, name: item.displayName ?? item.id, site: true })) : (result.drives ?? []).map((item) => ({ id: item.id, name: item.name ?? item.id, site: false }));
      setLocations((current) => pageToken ? [...(current ?? []), ...values] : values);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("storage.failed")); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2">
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load()}>{busy && <Loader2 className="size-3.5 animate-spin" />}{t("storage.choose_library")}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {locations && <div className="max-h-48 overflow-y-auto rounded-lg border p-1">
      {locations.length === 0 && <p className="p-2 text-xs text-muted-foreground">{t("storage.no_libraries")}</p>}
      {locations.map((item) => <Button key={item.id} type="button" variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => item.site ? void load(item.id) : onSelect(item.id)}>{item.name}</Button>)}
      {next && <Button type="button" variant="ghost" disabled={busy} onClick={() => void load(siteId, next)}>{t("storage.load_more")}</Button>}
    </div>}
  </div>;
}
