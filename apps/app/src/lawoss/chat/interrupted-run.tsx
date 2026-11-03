/**
 * LAWOSS (N-A9-16, test 2. 11. 2026): beh agenta prerušený zatvorením appky po reštarte nič nehovoril. Engine
 * takú odpoveď neuzavrie: nemá `time.completed` ani `error`, takže chat ukázal len kroky bez odpovede.
 *
 * Len zobrazenie, nie stav behu: príznak nesie metadata správy zo snapshotu (`usechat-adapter.ts`), vetu kreslí
 * skupina krokov odpovede v `message-list.tsx` (prázdnu prerušenú správu zoskupenie krokov inak pohltí).
 * Bez dokončenia aj bez chyby je aj práve bežiaca odpoveď, preto príznak dostane len odpoveď vytvorená pred
 * načítaním tejto appky, a posledná odpoveď len keď engine hlási nečinnosť.
 */
import type { UIMessage } from "ai";
import { t } from "@/i18n";

type AssistantInfo = { role: string; time?: { created?: number; completed?: number }; error?: unknown };

/** Odpoveď z predošlého behu appky, ktorú engine nikdy neuzavrel. */
export function interruptedBeforeLoad(info: AssistantInfo, input: { last: boolean; idle: boolean; loadedAt: number }): boolean {
  if (info.role !== "assistant" || info.error || typeof info.time?.completed === "number") return false;
  const created = info.time?.created;
  if (typeof created !== "number" || created >= input.loadedAt) return false;
  return !input.last || input.idle;
}

/** Začiatok tohto načítania appky (ms od epochy), rovnaká os ako `time.created` v engine. */
export const appLoadedAt = (): number => typeof performance === "undefined" ? Date.now() : performance.timeOrigin;

export function isInterruptedRun(message: UIMessage): boolean {
  const metadata: unknown = message.metadata;
  if (!metadata || typeof metadata !== "object") return false;
  const opencode: unknown = Reflect.get(metadata, "opencode");
  return Boolean(opencode && typeof opencode === "object" && Reflect.get(opencode, "interrupted") === true);
}

/** Veta pod odpoveďou; skupina krokov v `message-list.tsx` ju ukáže, keď niektorá jej správa nesie príznak. */
export function InterruptedRunNotice() {
  return <p role="status" className="text-sm text-muted-foreground">{t("lawoss.chat.interrupted_run")}</p>;
}
