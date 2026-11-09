/** @jsxImportSource react */
import { useState } from "react";
import type { StorageConnection } from "@legalwork/types/file-storage";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { t } from "@/i18n";

export function ShareCloudStorageDialog({ client, workspaceId, connection, onClose, onSaved }: {
  client: LegalworkServerClient; workspaceId: string; connection: StorageConnection; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(connection.name);
  const [root, setRoot] = useState(connection.config.kind === "oauth" ? connection.config.root : "");
  const [driveId, setDriveId] = useState(connection.config.kind === "oauth" ? connection.config.driveId ?? "" : "");
  const [mode, setMode] = useState<"member" | "team">("member");
  const [automatic, setAutomatic] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (connection.config.kind !== "oauth") return null;
  const config = connection.config;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t("storage.share_team")}</DialogTitle><DialogDescription>{t("storage.cloud_team_intro")}</DialogDescription></DialogHeader>
      <form id="share-cloud-storage" className="space-y-4" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try {
          await client.shareStorageConnection(workspaceId, { name, config: { ...config, root, driveId: driveId || undefined, sharingMode: mode },
            readOnly, enabled: true, teamInstallation: automatic ? "automatic" : "optional", secrets: {} });
          onSaved(); onClose();
        } catch (cause) { setError(cause instanceof Error ? cause.message : t("storage.failed")); }
        finally { setBusy(false); }
      }}>
        <Field><FieldLabel htmlFor="shared-storage-name">{t("storage.name")}</FieldLabel><Input id="shared-storage-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={busy} /></Field>
        <Field><FieldLabel htmlFor="shared-storage-root">{t("storage.oauth_root")}</FieldLabel><Input id="shared-storage-root" value={root} onChange={e => setRoot(e.target.value)} disabled={busy} /><FieldDescription>{t(config.provider === "google-drive" ? "storage.google_root_hint" : "storage.microsoft_root_hint")}</FieldDescription></Field>
        {config.provider !== "google-drive" && <Field><FieldLabel htmlFor="shared-storage-drive">{t("storage.drive_id")}</FieldLabel><Input id="shared-storage-drive" value={driveId} onChange={e => setDriveId(e.target.value)} disabled={busy} required={config.provider === "sharepoint-files"} /></Field>}
        <Field><FieldLabel htmlFor="shared-storage-mode">{t("storage.sharing_mode")}</FieldLabel>
          <select id="shared-storage-mode" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={mode} disabled={busy} onChange={e => setMode(e.target.value === "team" ? "team" : "member")}>
            <option value="member">{t("storage.sharing_member")}</option><option value="team">{t("storage.sharing_team")}</option>
          </select><FieldDescription>{mode === "team" ? t("storage.sharing_team_hint") : t("storage.sharing_member_hint")}</FieldDescription>
        </Field>
        <label className="flex items-center justify-between text-sm">{t("storage.read_only")}<Switch checked={readOnly} onCheckedChange={setReadOnly} disabled={busy} /></label>
        <label className="flex items-center justify-between text-sm">{t("storage.install_automatically")}<Switch checked={automatic} onCheckedChange={setAutomatic} disabled={busy} /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button form="share-cloud-storage" type="submit" disabled={busy}>{t("storage.share_team")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
