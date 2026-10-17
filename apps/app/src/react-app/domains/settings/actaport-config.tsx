/** @jsxImportSource react */
import { useEffect, useState } from "react";
import type { ActaportConnectionStatus, ActaportToolset } from "@legalwork/types/desktop-ipc";
import { desktopBridge } from "@/app/lib/desktop";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { registerExtensionConfig, type ExtensionConfigContext } from "./extension-registry";

const emptyCredentials = { realm: "", clientId: "", clientSecret: "", username: "", password: "" };
const fields: Array<{ name: keyof typeof emptyCredentials; label: string; secret?: boolean }> = [
  { name: "realm", label: "Kanzlei-Alias (Realm)" },
  { name: "clientId", label: "Client ID" },
  { name: "clientSecret", label: "Client Secret", secret: true },
  { name: "username", label: "API username" },
  { name: "password", label: "API password", secret: true },
];

registerExtensionConfig("actaport", (context) => <ActaportConfig context={context.actaport} />);

export function ActaportToolsets({ status, busy, onChange }: {
  status: ActaportConnectionStatus; busy: boolean; onChange: (selected: ActaportToolset[]) => void;
}) {
  const copy: Record<ActaportToolset, { label: string; hint: string }> = {
    records: { label: t("actaport.toolset_records"), hint: t("actaport.toolset_records_hint") },
    finance: { label: t("actaport.toolset_finance"), hint: t("actaport.toolset_finance_hint") },
    administration: { label: t("actaport.toolset_administration"), hint: t("actaport.toolset_administration_hint") },
    uploads: { label: t("actaport.toolset_uploads"), hint: t("actaport.toolset_uploads_hint") },
  };
  const total = status.coreToolCount + status.toolsets.filter((group) => status.enabledToolsets.includes(group.id))
    .reduce((count, group) => count + group.readTools + (status.allowWrites ? group.writeTools : 0), 0);
  return <div className="space-y-3">
    <div className="space-y-1">
      <p className="text-sm font-medium">{t("actaport.toolsets")}</p>
      <p className="text-xs text-muted-foreground">{t("actaport.core_tools", { count: status.coreToolCount })}</p>
      <p role="status" className="text-xs text-muted-foreground">{t("actaport.tools_count", { count: total })}</p>
    </div>
    {status.toolsets.map((group) => <div key={group.id} className="space-y-1">
      <Label htmlFor={`actaport-toolset-${group.id}`} className="leading-normal">
        <Checkbox id={`actaport-toolset-${group.id}`} disabled={busy} checked={status.enabledToolsets.includes(group.id)}
          onCheckedChange={(checked) => onChange(checked ? [...status.enabledToolsets, group.id] : status.enabledToolsets.filter((id) => id !== group.id))} />
        {copy[group.id].label}
      </Label>
      <p className="pl-6 text-xs text-muted-foreground">{copy[group.id].hint}</p>
      <p className="pl-6 text-xs text-muted-foreground">{t("actaport.toolset_count", { count: group.readTools + (status.allowWrites ? group.writeTools : 0) })}</p>
    </div>)}
    <p className="text-xs text-muted-foreground">{t("actaport.toolsets_hint")}</p>
  </div>;
}

export function ActaportConfig({ context }: { context?: ExtensionConfigContext["actaport"] }) {
  const [credentials, setCredentials] = useState(emptyCredentials);
  const [status, setStatus] = useState<ActaportConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const desktop = typeof window !== "undefined" && Boolean(window.__LEGALWORK_ELECTRON__?.invokeDesktop);
  useEffect(() => {
    if (!desktop) return;
    let current = true;
    void desktopBridge.actaportStatus().then((value) => { if (current) setStatus(value); })
      .catch(() => { if (current) setError(t("actaport.status_failed")); });
    return () => { current = false; };
  }, [desktop]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); }
    catch (value) { setError(value instanceof Error ? value.message : t("actaport.failed")); }
    finally { setBusy(false); }
  };
  const connectMcp = async () => {
    if (!context || await context.onConnect() === false) throw new Error(t("actaport.mcp_failed"));
    await context.onRefresh();
  };

  return <Card variant="outline" size="sm">
    <CardHeader><CardTitle>Actaport</CardTitle><CardDescription>{t("actaport.setup")}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {!desktop && <Alert><AlertDescription>{t("actaport.desktop_required")}</AlertDescription></Alert>}
      {status?.secureStorage === false && <Alert variant="destructive"><AlertDescription>{t("actaport.secure_storage_required")}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {status?.configured && !notice && <p className="text-sm text-muted-foreground">{t("actaport.saved")}</p>}
      <p className="text-sm text-muted-foreground">{t("actaport.credentials_hint")} <a className="underline" href="https://api.actaport.de/api-docs/rest-api/introduction/authentication" target="_blank" rel="noreferrer">{t("actaport.credentials_link")}</a></p>
      {(!status?.configured || editing) && <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          setStatus(await desktopBridge.actaportConnect(credentials));
          setCredentials(emptyCredentials);
          setEditing(false);
          await connectMcp();
          setNotice(t("actaport.connected"));
        });
      }}>
        {fields.map((field) => <div key={field.name} className="space-y-1.5">
          <Label htmlFor={`actaport-${field.name}`}>{field.name === "username" ? t("actaport.username") : field.name === "password" ? t("actaport.password") : field.label}</Label>
          <Input id={`actaport-${field.name}`} type={field.secret ? "password" : "text"} autoComplete="off" required
            disabled={!desktop || busy} value={credentials[field.name]}
            onChange={(event) => setCredentials((current) => ({ ...current, [field.name]: event.target.value }))} />
        </div>)}
        <Button type="submit" disabled={!desktop || !status?.secureStorage || busy}>{busy ? t("actaport.working") : t("actaport.save_connect")}</Button>
      </form>}
      {status?.configured && <div className="space-y-3 border-t border-border pt-4">
        <ActaportToolsets status={status} busy={busy} onChange={(selected) => {
          void run(async () => { setStatus(await desktopBridge.actaportSetToolsets(selected)); await connectMcp(); });
        }} />
        <Label htmlFor="actaport-writes" className="leading-normal">
          <Checkbox id="actaport-writes" checked={status.allowWrites} disabled={busy} onCheckedChange={(checked) => {
            void run(async () => { setStatus(await desktopBridge.actaportSetWriteAccess(checked)); await connectMcp(); });
          }} />{t("actaport.allow_writes")}
        </Label>
        <p className="text-xs text-muted-foreground">{t("actaport.writes_hint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void run(async () => { await desktopBridge.actaportTest(); setNotice(t("actaport.test_passed")); })}>{t("actaport.test")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void run(connectMcp)}>{t("actaport.connect_tools")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => { setEditing((value) => !value); setCredentials(emptyCredentials); }}>{editing ? t("common.cancel") : t("actaport.replace_credentials")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
            setStatus(await desktopBridge.actaportDisconnect());
            await context?.onDisconnect();
            await context?.onRefresh();
            setNotice(t("actaport.disconnected"));
          })}>{t("actaport.disconnect")}</Button>
        </div>
      </div>}
    </CardContent>
  </Card>;
}
