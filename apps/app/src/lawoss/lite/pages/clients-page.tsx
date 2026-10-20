/** @jsxImportSource react */
import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, FolderOpen, MessageSquare } from "lucide-react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { OkfPage, type OkfPageMeta } from "../../domains/okf-page";
import { litePageProps } from "../state-text";
import { formatDay, today, useOkfConnection, type OkfReadResult, type OkfScope } from "../../okf/read-model";
import { isOfficeFile } from "../../../../../../lawoss/okf/read";
import { urgencyOf } from "../../okf/view-rules";
import { groupByClient, nextDeadline, type ClientGroup } from "../today-model";
import { ATTACH_EXISTING_CLIENT_PATH, LITE_CLIENTS_PATH, liteMatterLink, NEW_CLIENT_PATH } from "../links";
import { clientPreferenceScope, clientRootOf, practiceClientChoices, type ClientChoice } from "../client-choice";
import { NewMatterAction } from "../client-picker";
import { conversationFailureKey, openCheckedConversation, useClientConversations } from "../client-tree-data";
import type { ConversationList } from "../client-tree";
import type { MatterConversation } from "../matter-conversations";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import { toast } from "@/components/ui/sonner";
import { TriageEntry } from "../../domains/roztriedenie/triage-entry";
import { hotDeadlineCount, LiveStamp, matterUrgency, useHotTitle, useMinuteTick } from "../live";
import "./okf-glass.css";
import "./clients.css";

export function ClientsPage() {
  const locale = useLocale();
  // Úplne prečítaná prázdna kancelária („Začať nanovo“) ukáže Klientov s „Pridať klienta“, nie prázdny stav prípadov.
  // Bez pripojeného priečinka (nová kancelária zo „Začať nanovo“ sa neregistruje) Klienti ponúknu „Pridať klienta“.
  return <OkfPage {...litePageProps(locale)} noWorkspace={<ClientsView groups={[]} locale={locale} />} hasContent={(data) => data.matters.length > 0 || (data.clients?.length ?? 0) > 0 || !(data.problems.length || data.truncated)}>{(data, meta, scope) => <ClientsLive data={data} meta={meta} scope={scope} locale={locale} />}</OkfPage>;
}

function ClientsLive({ data, meta, scope, locale }: { data: OkfReadResult; meta: OkfPageMeta; scope: OkfScope | null; locale: Language }) {
  useMinuteTick();
  useHotTitle(hotDeadlineCount(data, today()));
  const { connection } = useOkfConnection();
  // Klik na klienta v bočnom strome: `?klient=` ukáže len jeho kartu (prehľad klienta).
  const [params] = useSearchParams();
  const choices = useMemo(() => practiceClientChoices(scope, data.clients), [scope, data.clients]);
  // Karta klienta ide rovno do svojho klienta, bez výberu.
  const clientRoot = (key: string) => key.startsWith("client:") ? clientRootOf(scope, key.slice("client:".length)) : undefined;
  const groups = useMemo(() => groupByClient(data.matters, data.inputs, data.clients), [data]);
  const focus = params.get("klient");
  // Rozhovory nad celým klientom (koreň jeho priečinka): „Zobraziť všetky“ zo stromu vedie sem.
  const conversations = useClientConversations(connection, scope, groups, focus);
  const navigate = useNavigate();
  const opening = useRef(false);
  const onOpen = (conversation: MatterConversation) => {
    const fallback = workspaceSessionRoute(conversation.workspaceId, conversation.id);
    if (!connection) { navigate(fallback); return; }
    // Ako strom: druhý klik počas aktivácie priečinka nič nespustí.
    if (opening.current) return;
    opening.current = true;
    // #168: priečinok sa aktivuje len po overení praxe a čerstvého zdroja. Pri chybe sa chat neotvorí: jeho trasa
    // by priečinok aktivovala bez overenia. Advokát dostane vetu (odmietnutie overenia alebo všeobecná chyba).
    openCheckedConversation(conversation, { scope, connection })
      .then((result) => { if (result.kind === "open") navigate(result.to); else toast.error(t(conversationFailureKey(result), locale)); })
      .finally(() => { opening.current = false; });
  };
  return <ClientsView groups={groups} meta={meta} locale={locale} actions={<TriageEntry />}
    choices={choices} preferenceScope={clientPreferenceScope(scope, connection?.baseUrl)} activeId={connection?.activeWorkspaceId} clientRoot={clientRoot} focus={focus}
    clientConversations={conversations} onOpenConversation={onOpen} />;
}

const reveal = (index: number): CSSProperties & Record<"--lw-i", number> => ({ "--lw-i": index });
const initials = (name: string) => name.split(/\s+/).filter((part) => /\p{L}/u.test(part[0] ?? "")).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "·";

/** Klienti ako karty s ich vecami; najbližšia lehota a jej naliehavosť z tej istej pamäte ako Dnes. */
/** `actions`: ďalšie vstupy vedľa novej veci (roztriedenie skúšobného klona). */
export function ClientsView({ groups: all, meta, locale: forced, actions, choices, activeId, clientRoot, preferenceScope, focus, clientConversations, onOpenConversation }: {
  groups: readonly ClientGroup[]; meta?: OkfPageMeta; locale?: Language; actions?: ReactNode;
  /** Prax: klienti na krátky výber pri „+ Nový prípad“ a priečinok klienta z karty (prehľad praxe). */
  choices?: readonly ClientChoice[]; activeId?: string | null; preferenceScope?: string; clientRoot?: (groupKey: string) => string | undefined;
  /** Kľúč klienta z bočného stromu: len jeho karta; neznámy kľúč (premenovaný priečinok) = všetci. */
  focus?: string | null;
  /** Rozhovory vybraného klienta (prehľad klienta). */
  clientConversations?: ConversationList;
  onOpenConversation?: (conversation: MatterConversation) => void;
}) {
  const current = useLocale();
  const locale = forced ?? current;
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.lite.${key}`, locale, params);
  const now = today();
  const focused = focus ? all.filter((group) => group.key === focus) : [];
  const groups = focused.length > 0 ? focused : all;
  return (
    <div className="lw-clients" data-lawoss-lite="clients">
      <header className="lw-clients-hero" style={reveal(0)}>
        <div>
          {meta ? <p className="lw-clients-topline"><LiveStamp meta={meta} locale={locale} /></p> : null}
          <h1 className="lw-h1">{text("clients_title")}</h1>
          {focused.length > 0 ? <p className="lw-clients-back"><Link to={LITE_CLIENTS_PATH}>{t("lawoss.lite.clients_all", locale)}</Link></p> : null}
        </div>
        <div className="lw-clients-actions">
          {actions}
          <Link className="lw-btn" to={NEW_CLIENT_PATH}>{text("add_client")}</Link>
          <Link className="lw-btn" to={ATTACH_EXISTING_CLIENT_PATH}>{text("attach_existing_client")}</Link>
          {/* Prehľad jedného klienta (bočný strom): nový prípad rovno u neho, bez výberu klienta (test 19. 10. 2026). */}
          <NewMatterAction className="lw-today-primary" locale={locale} choices={choices} activeId={activeId} preferenceScope={preferenceScope} clientRoot={focused[0] ? clientRoot?.(focused[0].key) : undefined}>+ {text("new_matter")}</NewMatterAction>
        </div>
      </header>

      {focused.length > 0 && clientConversations ? <ClientConversations list={clientConversations} locale={locale} onOpen={onOpenConversation} /> : null}

      {groups.length === 0 ? <div className="lw-clients-empty" style={reveal(1)}>
        <FolderOpen aria-hidden size={28} />
        <p>{text("clients_empty")}</p>
        <Link className="lw-today-primary" to={NEW_CLIENT_PATH}>{text("add_client")}</Link>
      </div> : <div className="lw-clients-grid">
        {groups.map((group, index) => {
          const hot = group.matters.some((m) => matterUrgency(m.deadlines, now) === "hot");
          return (
            <section key={group.key} className="lw-clients-card" style={reveal(index + 1)} data-urgency={hot ? "hot" : undefined}>
              <header className="lw-clients-card-head">
                <span className="lw-matter-avatar" aria-hidden>{initials(group.client || text("client_unnamed"))}</span>
                <h2>{group.client || text("client_unnamed")}</h2>
                <span className="lw-matter-count">{group.matters.length}</span>
              </header>
              {group.matters.length === 0 ? <p className="lw-clients-none">{text("client_no_matters")} <NewMatterAction locale={locale} clientRoot={clientRoot?.(group.key)}>{text("new_matter")}</NewMatterAction></p> : null}
              <ul className="lw-clients-matters">
                {group.matters.map((m) => {
                  const own = m.deadlines.filter((d) => !isOfficeFile(d.file));
                  const next = nextDeadline(own, now);
                  const urgency = matterUrgency(own, now);
                  // Lehota po termíne alebo s neplatným dátumom má prednosť pred najbližšou budúcou.
                  const missed = own.some((d) => d.invalid || d.date < now);
                  return (
                    <li key={m.path}>
                      <Link className="lw-clients-matter" to={liteMatterLink(m.path)} data-urgency={urgency} title={m.title}>
                        <span className="lw-clients-dot" aria-hidden />
                        <span className="lw-clients-matter-main">
                          <span className="lw-clients-matter-title">{m.title}</span>
                          <small>{[m.matterRef, m.court].filter(Boolean).join(" · ")}</small>
                        </span>
                        {missed ? <span className="lw-today-chip" data-urgency="hot">{text("overdue")}</span>
                          : next ? <span className="lw-today-chip" data-urgency={urgencyOf(next, now)}>{text("matter_next_deadline", { date: formatDay(next, locale) })}</span>
                          : urgency ? <span className="sr-only">{text("urgent")}</span> : null}
                        <ArrowUpRight aria-hidden size={15} className="lw-clients-arrow" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>}
    </div>
  );
}

/** Rozhovory nad celým klientom; pri chybe hláška a „Skúsiť znova“, pri limite poznámka. */
function ClientConversations({ list, locale, onOpen }: { list: ConversationList; locale: Language; onOpen?: (conversation: MatterConversation) => void }) {
  if (list.status === "loading" || (list.status === "ready" && list.items.length === 0)) return null;
  return <section className="lw-clients-card lw-clients-conversations" style={reveal(1)} data-lawoss-lite="client-conversations">
    <header className="lw-clients-card-head">
      <MessageSquare aria-hidden size={18} />
      <h2>{t("lawoss.lite.client_conversations_title", locale)}</h2>
      {list.status === "ready" ? <span className="lw-matter-count">{list.items.length}</span> : null}
    </header>
    {list.status === "error" ? <p className="lw-clients-none" role="status">
      {t("lawoss.lite.tree_load_error", locale)} {list.retry ? <button type="button" className="lw-btn" onClick={() => list.retry?.()}>{t("lawoss.lite.state_retry", locale)}</button> : null}
    </p> : null}
    {list.status === "ready" && !list.complete ? <p className="lw-clients-none">{t("lawoss.lite.conversations_partial", locale)}</p> : null}
    <ul className="lw-clients-matters">
      {list.items.map((c) => <li key={c.id}>
        <button type="button" className="lw-clients-matter" onClick={() => onOpen?.(c)} data-lawoss-client-conversation={c.id}>
          <span className="lw-clients-matter-main">
            <span className="lw-clients-matter-title">{c.title ?? t("lawoss.lite.conversation_untitled", locale)}</span>
            {c.updated ? <small>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(c.updated))}</small> : null}
          </span>
          <span className="lw-today-chip">{t("lawoss.lite.conversation_continue", locale)}</span>
        </button>
      </li>)}
    </ul>
  </section>;
}
