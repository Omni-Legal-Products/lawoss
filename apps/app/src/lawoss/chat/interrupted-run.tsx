/**
 * LAWOSS (N-A9-16, test 2. 11. 2026; #473): beh agenta prerušený zatvorením appky alebo pádom enginu nič nehovoril.
 * Engine takú odpoveď neuzavrie: nemá `time.completed` ani `error` a priebežne písaný text neuloží (overené
 * s vydaným enginom v `apps/server/src/lawoss/engine-killed-answer.released.test.ts`), takže chat ukázal len kroky
 * alebo useknutý text a vyzeral hotový.
 *
 * Len zobrazenie, nie stav behu: príznak nesie metadata správy zo snapshotu (`usechat-adapter.ts`), vetu kreslí
 * skupina krokov odpovede v `message-list.tsx` (prázdnu prerušenú správu zoskupenie krokov inak pohltí).
 * Bez dokončenia aj bez chyby je aj práve bežiaca odpoveď, preto príznak dostane len odpoveď vytvorená skôr, než
 * začal terajší engine: pred načítaním tejto appky, alebo pred reštartom enginu, ktorý hlási server
 * (`engineRestartedAt` v snapshote). Posledná odpoveď len keď engine hlási nečinnosť.
 */
import type { UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

type AssistantInfo = { role: string; time?: { created?: number; completed?: number }; error?: unknown };
export type InterruptedBy = "app_closed" | "engine_restart";

/** Odpoveď, ktorú engine nikdy neuzavrel, lebo appka alebo engine medzitým skončili. */
export function interruptedRun(info: AssistantInfo, input: { last: boolean; idle: boolean; loadedAt: number; engineRestartedAt?: number }): InterruptedBy | null {
  if (info.role !== "assistant" || info.error || typeof info.time?.completed === "number") return null;
  const created = info.time?.created;
  if (typeof created !== "number" || (input.last && !input.idle)) return null;
  if (created < input.loadedAt) return "app_closed";
  return input.engineRestartedAt !== undefined && created < input.engineRestartedAt ? "engine_restart" : null;
}

/** Začiatok tohto načítania appky (ms od epochy), rovnaká os ako `time.created` v engine. */
export const appLoadedAt = (): number => typeof performance === "undefined" ? Date.now() : performance.timeOrigin;

export function interruptedReason(message: UIMessage): InterruptedBy | null {
  const metadata: unknown = message.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const opencode: unknown = Reflect.get(metadata, "opencode");
  const reason: unknown = opencode && typeof opencode === "object" ? Reflect.get(opencode, "interrupted") : undefined;
  return reason === "app_closed" || reason === "engine_restart" ? reason : null;
}

/** Text otázky, na ktorú prerušená odpoveď odpovedala (posledná správa advokáta pred ňou). */
export function questionBefore(messages: readonly UIMessage[], index: number): string | null {
  const question = messages.slice(0, index).findLast((message) => message.role === "user");
  const text = question?.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim();
  return text || null;
}

/** Veta pod odpoveďou; skupina krokov v `message-list.tsx` ju ukáže, keď niektorá jej správa nesie príznak. */
export function InterruptedRunNotice(props: { reason: InterruptedBy; onRetry?: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <p>{t(props.reason === "engine_restart" ? "lawoss.chat.interrupted_restart" : "lawoss.chat.interrupted_run")}</p>
      {props.onRetry ? <Button variant="outline" size="xs" onClick={props.onRetry}>{t("lawoss.chat.interrupted_retry")}</Button> : null}
    </div>
  );
}
