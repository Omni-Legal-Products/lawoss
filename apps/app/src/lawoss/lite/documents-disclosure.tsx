/** @jsxImportSource react */
/**
 * Test alfy 14. 11. 2026 (Dokumenty klienta): blok „Spracovanie dokumentov“ (tlačidlá, vysvetlenia, profil prípadu,
 * Generovať cez chat) zaberal vrch stránky pred vyhľadávaním a zoznamom priečinkov. V bežnom režime je za jedným
 * zbaleným riadkom; obsah ostáva pripojený (stav, čítania a tlačidlá sa nemenia), nič sa neodstraňuje. Pokročilý
 * režim ho ukazuje ako doteraz.
 */
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { t } from "@/i18n";
import { useUiMode } from "./ui-mode";

export function LiteDocumentsDisclosure({ children }: { children: ReactNode }) {
  return <DocumentsDisclosureView lite={useUiMode() === "lite"}>{children}</DocumentsDisclosureView>;
}

/** Test seam: zobrazenie podľa režimu. */
export function DocumentsDisclosureView({ lite, children }: { lite: boolean; children: ReactNode }) {
  if (!lite) return <>{children}</>;
  return <details className="group shrink-0 border-b border-border open:max-h-[50%] open:overflow-auto" data-lawoss-documents-disclosure="">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      {t("lawoss.lite.documents_processing")}
    </summary>
    {children}
  </details>;
}
