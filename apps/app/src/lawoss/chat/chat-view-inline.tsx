// LAWOSS (rozhodnutie MČ 10. 11. 2026, špecifikácia 0017): prehľad vytvorený agentom sa ukáže priamo
// v chate v karte nástroja, nielen na karte vedľa chatu. Chat nie je virtualizovaný, preto sa naraz
// vykreslia najviac posledné prehľady (CHAT_INLINE_VIEW_LIMIT); staršie ostávajú kompaktnou kartou
// s tlačidlom „Otvoriť" (rozpočet RAM 2 GB, #367).
import { createContext, lazy, Suspense, useContext, useMemo, type ReactNode } from "react";
import type { UIMessage } from "ai";
import type { ViewPreview, ViewReference } from "@legalwork/types/views";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

const SavedView = lazy(() => import("@/react-app/domains/views/view-renderer").then(module => ({ default: module.SavedView })));
const PreviewView = lazy(() => import("@/react-app/domains/views/view-renderer").then(module => ({ default: module.PreviewView })));

export const CHAT_INLINE_VIEW_LIMIT = 3;
const VIEW_TOOLS = ["view_create", "view_update", "view_read"];

/** Posledné dokončené volania nástrojov prehľadov v chate, od najnovšieho. */
export function latestViewCallIds(messages: Pick<UIMessage, "parts">[], limit = CHAT_INLINE_VIEW_LIMIT): string[] {
  const ids: string[] = [];
  for (let m = messages.length - 1; m >= 0 && ids.length < limit; m--) {
    const parts = messages[m].parts;
    for (let p = parts.length - 1; p >= 0 && ids.length < limit; p--) {
      const part = parts[p];
      if (part.type === "dynamic-tool" && part.state === "output-available" && VIEW_TOOLS.includes(part.toolName) && !ids.includes(part.toolCallId)) ids.push(part.toolCallId);
    }
  }
  return ids;
}

// Bez poskytovateľa (karta mimo zoznamu správ) sa prehľad vykreslí.
const Budget = createContext<ReadonlySet<string> | null>(null);

export function ChatInlineViewBudget({ messages, children }: { messages: UIMessage[]; children: ReactNode }) {
  // Kľúč je text, aby sa karty počas streamovania odpovede neprekresľovali s každým tokenom.
  const key = latestViewCallIds(messages).join("\n");
  const allowed = useMemo(() => new Set(key ? key.split("\n") : []), [key]);
  return <Budget.Provider value={allowed}>{children}</Budget.Provider>;
}

export function useChatInlineViewAllowed(toolCallId: string) {
  const allowed = useContext(Budget);
  return allowed ? allowed.has(toolCallId) : true;
}

type Props = { client: LegalworkServerClient; toolCallId: string; generationId: string; saved?: ViewReference | null; preview?: ViewPreview; readOnly?: boolean };

/** Vykreslený prehľad pod hlavičkou karty: výška je ohraničená a široké tabuľky sa posúvajú vnútri karty. */
export function ChatInlineView({ client, toolCallId, generationId, saved, preview, readOnly }: Props) {
  const allowed = useChatInlineViewAllowed(toolCallId);
  if (!allowed || (!saved && !preview)) return null;
  return <div data-chat-inline-view="" className="max-h-[420px] min-w-0 max-w-full overflow-auto overscroll-x-contain border-t" style={{ containerType: "inline-size" }}>
    <Suspense fallback={<p role="status" className="p-4 text-xs text-muted-foreground">{t("views.loading")}</p>}>
      {saved
        ? <SavedView client={client} reference={saved} inline readOnly={readOnly} />
        : preview ? <div className="lw-saved-view lw-saved-view-inline"><PreviewView client={client} preview={preview} generationId={generationId} /></div> : null}
    </Suspense>
  </div>;
}
