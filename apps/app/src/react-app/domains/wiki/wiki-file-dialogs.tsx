import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { WikiEntry, WikiEntryOperation } from "@legalwork/types/wiki";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import { wikiError } from "./wiki-dialogs";

export type WikiFileDialogAction = { action: "create-folder"; path: string } | { action: "rename" | "move" | "copy" | "trash"; entry: WikiEntry; value: string };

export function WikiFileDialog(props: { value: WikiFileDialogAction; folders: string[]; onClose: () => void; onSubmit: (operation: WikiEntryOperation) => Promise<void> }) {
  const action = props.value.action;
  const source = "entry" in props.value ? props.value.entry : null;
  const parent = source?.path.includes("/") ? source.path.slice(0, source.path.lastIndexOf("/")) : "";
  const destinations = [{ value: "", label: t("wiki.wiki_root") }, ...props.folders.filter((folder) => source?.kind !== "folder" || (folder !== source.path && !folder.startsWith(`${source.path}/`))).map((folder) => ({ value: folder, label: folder }))];
  const [value, setValue] = useState("value" in props.value ? props.value.value : props.value.path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = t(action === "create-folder" ? "wiki.new_folder" : action === "rename" ? "wiki.rename" : action === "move" ? "wiki.move" : action === "copy" ? "wiki.duplicate" : "wiki.move_to_trash");
  const submit = async () => {
    let operation: WikiEntryOperation;
    if (action === "create-folder") operation = { action, path: value.trim() };
    else if (!source) return;
    else if (action === "trash") operation = { action, path: source.path, baseRevision: source.revision };
    else {
      const name = source.path.split("/").at(-1) ?? source.path;
      if (action === "rename" && (!value.trim() || /[/\\\x00-\x1f\x7f]/.test(value))) throw new Error(t("wiki.invalid_entry_name"));
      const renamed = source.kind === "file" && /\.md$/i.test(source.path) && !/\.md$/i.test(value) ? `${value.trim()}.md` : value.trim();
      const destination = action === "move" ? `${value ? `${value}/` : ""}${name}` : action === "rename" ? `${parent ? `${parent}/` : ""}${renamed}` : value.trim();
      operation = { action: action === "copy" ? "copy" : "move", path: source.path, destination, baseRevision: source.revision };
    }
    await props.onSubmit(operation);
    props.onClose();
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) props.onClose(); }}>
    <DialogContent className="wiki-dialog sm:max-w-md">
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(null); void submit().catch((error) => setError(wikiError(error))).finally(() => setBusy(false)); }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{action === "trash" ? t("wiki.trash_hint") : source?.path ?? t("wiki.new_folder_hint")}</DialogDescription></DialogHeader>
        {action === "trash" ? <p className="break-all text-sm font-medium">{source?.path}</p> : <label className="grid gap-2 text-sm">{t(action === "move" ? "wiki.destination_folder" : action === "rename" ? "wiki.entry_name" : "wiki.relative_path")}
          {action === "move" ? <Select value={value} items={destinations} disabled={busy} onValueChange={(next) => { if (next !== null) setValue(next); }}><SelectTrigger autoFocus className="w-full" aria-label={t("wiki.destination_folder")}><SelectValue /></SelectTrigger><SelectContent>{destinations.map((folder) => <SelectItem key={folder.value} value={folder.value}>{folder.label}</SelectItem>)}</SelectContent></Select>
            : <Input autoFocus required value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} />}
        </label>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={props.onClose}>{t("wiki.cancel")}</Button><Button type="submit" variant={action === "trash" ? "destructive" : "default"} disabled={busy || (action === "move" ? value === parent : action !== "trash" && !value.trim())}>{busy ? <Loader2 size={16} className="animate-spin" /> : null}{title}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
