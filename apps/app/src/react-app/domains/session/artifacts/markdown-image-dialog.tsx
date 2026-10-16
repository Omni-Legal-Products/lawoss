import { useEffect, useId, useRef, useState } from "react";
import { closeImageDialog$, imageDialogState$, imageUploadHandler$, saveImage$, useCellValues, usePublisher } from "@mdxeditor/editor";
import { ImagePlus, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

/** Keep image insertion in the same visual language as the rest of the app. */
export function MarkdownImageDialog() {
  const [state, upload] = useCellValues(imageDialogState$, imageUploadHandler$);
  const close = usePublisher(closeImageDialog$);
  const save = usePublisher(saveImage$);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (state.type === "inactive") return;
    setTab(state.type === "editing" || !upload ? "link" : "upload");
    setSrc(state.type === "editing" ? state.initialValues.src ?? "" : "");
    setAlt(state.type === "editing" ? state.initialValues.altText ?? "" : "");
    setFile(null); setError("");
  }, [state, upload]);
  const selectFile = (next: File | undefined) => {
    if (!next) return;
    if (!next.type.startsWith("image/")) { setError(t("markdown.image.invalid")); return; }
    setFile(next); setError("");
  };
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const source = tab === "upload" && file && upload ? await upload(file) : src.trim();
      if (!source) return;
      save({ ...(state.type === "editing" ? state.initialValues : { title: "" }), src: source, altText: alt });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("markdown.image.failed")); }
    finally { setBusy(false); }
  };
  return <Dialog open={state.type !== "inactive"} onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent className="markdown-image-dialog" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{t(state.type === "editing" ? "markdown.image.edit" : "markdown.image.insert")}</DialogTitle><DialogDescription>{t("markdown.image.description")}</DialogDescription></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); void submit(); }} className="grid gap-5">
        {upload && <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label={t("markdown.image.source")}>
          {(["upload", "link"] satisfies ("upload" | "link")[]).map(value => <Button key={value} type="button" role="tab" aria-selected={tab === value} variant={tab === value ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setTab(value)}>{value === "upload" ? t("markdown.image.upload") : t("markdown.image.link")}</Button>)}
        </div>}
        {tab === "upload" ? <>
          <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label={t("markdown.image.choose")} onChange={event => selectFile(event.target.files?.[0])} />
          <button type="button" disabled={busy} className="lw-image-dropzone" onClick={() => input.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }}>
            {file ? <ImagePlus size={28} /> : <Upload size={28} />}<span>{file?.name ?? t("markdown.image.choose")}</span><small>{t("markdown.image.drop")}</small>
          </button>
        </> : <div className="grid gap-2"><label htmlFor={`${id}-url`}>{t("markdown.image.url")}</label><Input id={`${id}-url`} value={src} onChange={event => setSrc(event.target.value)} placeholder="https://" autoFocus /></div>}
        <div className="grid gap-2"><label htmlFor={`${id}-alt`}>{t("markdown.image.alt")}</label><Input id={`${id}-alt`} value={alt} onChange={event => setAlt(event.target.value)} placeholder={t("markdown.image.alt_placeholder")} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={() => close()}>{t("common.cancel")}</Button><Button type="submit" disabled={busy || (tab === "upload" ? !file : !src.trim())}>{busy && <Loader2 className="animate-spin" />}{t(state.type === "editing" ? "common.save" : "markdown.image.insert")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
