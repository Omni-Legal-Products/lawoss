import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Paperclip, X } from "lucide-react";
import type { WikiSuggestion } from "@legalwork/types/wiki-suggestions";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/lib/utils";
import { t } from "@/i18n";
import { ImagePreview, PdfPreview, PreviewError, PreviewLoading } from "../session/artifacts/preview";

export function WikiSuggestionAttachments({ client, draft, disabled, selected, onSelect, onRemove }: {
  client: LegalworkServerClient; draft: WikiSuggestion; disabled: boolean; selected: string | null;
  onSelect: (name: string | null) => void; onRemove: (name: string) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const file = draft.attachments.find(file => file.name === selected);
  useEffect(() => { if (selected) section.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const query = useQuery({ queryKey: ["wiki-suggestion-attachment", client.baseUrl, draft.workspaceId, draft.id, file?.sha256, draft.revision],
    queryFn: () => client.downloadWikiSuggestionAttachment(draft.workspaceId, draft.id, file!.sha256, draft.revision), enabled: Boolean(file), gcTime: 0, retry: false });
  const [preview, setPreview] = useState<{ data: ArrayBuffer; url: string } | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const url = URL.createObjectURL(new Blob([query.data.data], { type: query.data.contentType ?? "application/octet-stream" }));
    setPreview({ data: query.data.data, url });
    return () => URL.revokeObjectURL(url);
  }, [query.data]);
  if (!draft.attachments.length) return null;
  const url = preview?.data === query.data?.data ? preview?.url : undefined;
  return <section ref={section} className="mt-4 rounded-lg border p-3" aria-label={t("wiki.source_files")}>
    <h3 className="flex items-center gap-2 text-sm font-medium"><Paperclip className="size-4" />{t("wiki.source_files")}</h3>
    <p className="mt-1 text-xs text-muted-foreground">{t("wiki.source_files_draft")}</p>
    <ul className="mt-2 divide-y">
      {draft.attachments.map(attachment => <li key={attachment.name} className="flex items-center gap-2 py-2">
        <button type="button" className="min-w-0 flex-1 text-left text-sm hover:underline" aria-expanded={selected === attachment.name} onClick={() => onSelect(selected === attachment.name ? null : attachment.name)}><span className="block truncate">{attachment.name}</span><span className="block text-xs text-muted-foreground">{formatFileSize(attachment.size)}</span></button>
        {draft.status === "pending" && <Button size="sm" variant="ghost" disabled={disabled} aria-label={t("wiki.remove_source_file", { name: attachment.name })} onClick={() => onRemove(attachment.name)}>{t("wiki.remove_source")}</Button>}
      </li>)}
    </ul>
    {file && <div className="mt-2 border-t pt-3">
      <div className="mb-2 flex items-center gap-2 text-xs"><span className="mr-auto truncate">{file.name}</span>{url && <a className="underline underline-offset-2" href={url} download={file.name}>{t("wiki.download_source")}</a>}<Button variant="ghost" size="icon-sm" aria-label={t("wiki.close_source_preview")} onClick={() => onSelect(null)}><X className="size-4" /></Button></div>
      {query.error ? <PreviewError className="h-32" message={query.error.message} /> : !url ? <PreviewLoading className="h-32" /> : /\.pdf$/i.test(file.name) ? <PdfPreview className="h-[520px]" url={url} title={file.name} /> : /\.(png|jpe?g|gif|webp)$/i.test(file.name) ? <ImagePreview className="max-h-[520px] overflow-auto" src={url} alt={file.name} /> : <p className="py-4 text-xs text-muted-foreground">{t("wiki.download_source_to_review")}</p>}
    </div>}
  </section>;
}
