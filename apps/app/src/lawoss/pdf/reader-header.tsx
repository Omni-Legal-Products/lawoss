import type { ReactNode } from "react";
import { Download, Ellipsis, ExternalLink, Feather, FolderOpen, Maximize2, Minimize2, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import type { useChevron7FileAction } from "@/lawoss/domains/integrations/chevron7-file-action";
import "./reader.css";

type ReaderHeaderProps = {
  title: string;
  size?: string;
  signing: ReturnType<typeof useChevron7FileAction>;
  expanded: boolean;
  toggleExpanded: () => void;
  download?: () => void;
  reveal?: () => void;
  open?: () => void;
  close: () => void;
  children?: ReactNode;
};

export function PdfReaderHeader({ title, size, signing, expanded, toggleExpanded, download, reveal, open, close, children }: ReaderHeaderProps) {
  const expand = t(expanded ? "artifact.restore_panel" : "artifact.expand_document");
  const more = t("lawoss.pdf_reader.actions");
  return <header className="lawoss-pdf-header titlebar-no-drag">
    <div className="lawoss-pdf-heading">
      <span className="lawoss-pdf-sheet" aria-hidden="true">PDF</span>
      <div className="lawoss-pdf-identity"><h2 title={title}>{title}</h2>{size && <small>{size}</small>}</div>
      {children}
      {signing && <button type="button" className="lawoss-pdf-sign" title={signing.label} aria-label={signing.label} disabled={signing.disabled} onClick={signing.onClick}>
        <Feather aria-hidden="true" /><span>{signing.label}</span>
      </button>}
      <div className="lawoss-pdf-utilities">
        <button type="button" onClick={toggleExpanded} title={expand} aria-label={expand}>{expanded ? <Minimize2/> : <Maximize2/>}</button>
        <DropdownMenu>
          <DropdownMenuTrigger className="lawoss-pdf-menu-trigger" title={more} aria-label={more}><Ellipsis/></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {download && <DropdownMenuItem onClick={download}><Download/>{t("artifact.download")}</DropdownMenuItem>}
            {reveal && <DropdownMenuItem onClick={reveal}><FolderOpen/>{t("artifact.show_in_folder")}</DropdownMenuItem>}
            {open && <DropdownMenuItem onClick={open}><ExternalLink/>{t("lawoss.file_preview.open_external")}</DropdownMenuItem>}
            <DropdownMenuItem onClick={close}><X/>{t("artifact.close")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </header>;
}
