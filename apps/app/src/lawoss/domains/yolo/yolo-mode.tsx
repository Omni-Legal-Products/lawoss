/** @jsxImportSource react */
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { currentLocale, t, type Language } from "@/i18n";
import { createLegalworkServerClient, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import { resolveLegalworkConnection } from "@/react-app/shell/legalwork-connection";
import {
  LayoutSection,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
} from "@/react-app/domains/settings/settings-layout";

/**
 * „YOLO Mode" (MČ 20. 10. 2026) in native Settings → Safety, beside the tool
 * permissions it overrides. The server owns the state (apps/server/src/lawoss/yolo-mode.ts):
 * a per-device flag in the global tool-permission row. This module shows it, asks for an
 * in-page confirmation before switching on, marks the composer and tells the model.
 */
export type YoloMode = { enabled: boolean; locked: boolean; source: "default" | "user" | "organization" };

export function parseYoloMode(value: unknown): YoloMode | null {
  if (typeof value !== "object" || value === null) return null;
  const enabled: unknown = Reflect.get(value, "enabled"), locked: unknown = Reflect.get(value, "locked"), source: unknown = Reflect.get(value, "source");
  if (typeof enabled !== "boolean" || typeof locked !== "boolean") return null;
  if (source !== "default" && source !== "user" && source !== "organization") return null;
  return { enabled, locked, source };
}

// Last known state, shared by the Settings row, the composer badge and the turn context.
let current: YoloMode | null = null;
const listeners = new Set<() => void>();

export function publishYoloMode(next: YoloMode | null) {
  if (next && current && next.enabled === current.enabled && next.locked === current.locked && next.source === current.source) return;
  current = next;
  for (const listener of listeners) listener();
}

function useYoloMode(): YoloMode | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
    () => current,
  );
}

/** Fixed hidden context for the next message while YOLO Mode is on; the system prompt never changes. */
export function yoloTurnContext(): string | null {
  return current?.enabled
    ? "YOLO Mode is on: the lawyer allows you to move, rename, edit and delete files and run commands without approval prompts, also directly in the client's original folder. Do it with your ordinary tools when asked; LAWOSS cannot undo these changes."
    : null;
}

export async function saveYoloMode(client: Pick<LegalworkServerClient, "setLawossYolo">, enabled: boolean): Promise<YoloMode> {
  const mode = parseYoloMode(await client.setLawossYolo(enabled));
  if (!mode) throw new Error("YOLO Mode was not returned");
  return mode;
}

export async function loadYoloMode(client: Pick<LegalworkServerClient, "lawossYolo">): Promise<YoloMode> {
  const mode = parseYoloMode(await client.lawossYolo());
  if (!mode) throw new Error("YOLO Mode was not returned");
  return mode;
}

/** Switching on always goes through the confirmation; switching off saves at once. */
export function requestYoloChange(enabled: boolean): "confirm" | "save" {
  return enabled ? "confirm" : "save";
}

function stateText(mode: YoloMode | null, locale: Language) {
  if (mode?.locked) return { state: "locked", text: t("lawoss.yolo.state_locked", locale) };
  if (mode?.enabled) return { state: "on", text: t("lawoss.yolo.state_on", locale) };
  return { state: "off", text: t("lawoss.yolo.state_off", locale) };
}

export function YoloModeRowView(props: { locale: Language; mode: YoloMode | null; canWrite: boolean; busy: boolean; confirming: boolean;
  failed: boolean; loadFailed?: boolean; onRequestChange: (enabled: boolean) => void; onConfirm: () => void; onCancel: () => void }) {
  const { state, text } = stateText(props.mode, props.locale);
  const title = t("lawoss.yolo.title", props.locale);
  const confirmTitleId = useId();
  return (
    <LayoutSection>
      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{title}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("lawoss.yolo.description", props.locale)}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch aria-label={title} checked={Boolean(props.mode?.enabled)}
              disabled={!props.canWrite || !props.mode || props.mode.locked || props.busy || props.confirming}
              onCheckedChange={(next: boolean) => props.onRequestChange(next)} />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        <p role="status" data-lawoss-yolo={state} className="text-[13px] leading-relaxed text-foreground">{text}</p>
        {/* Both directions: a running engine keeps its rules until the idle reload. */}
        {props.mode && !props.mode.locked ? <p className="text-[13px] text-muted-foreground">{t("lawoss.yolo.applies", props.locale)}</p> : null}
        {props.confirming ? (
          <div role="alertdialog" aria-labelledby={confirmTitleId} className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p id={confirmTitleId} className="text-sm font-medium text-ink">{t("lawoss.yolo.confirm_title", props.locale)}</p>
            <p className="text-[13px] leading-relaxed text-foreground">{t("lawoss.yolo.confirm_body", props.locale)}</p>
            <p className="text-[13px] leading-relaxed text-foreground">{t("lawoss.yolo.confirm_clients", props.locale)}</p>
            <p className="text-[13px] font-medium leading-relaxed text-foreground">{t("lawoss.yolo.confirm_undo", props.locale)}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Button variant="destructive" disabled={props.busy} onClick={props.onConfirm}>{t("lawoss.yolo.confirm_on", props.locale)}</Button>
              <Button variant="outline" disabled={props.busy} onClick={props.onCancel}>{t("lawoss.yolo.confirm_cancel", props.locale)}</Button>
            </div>
          </div>
        ) : null}
        {props.loadFailed ? <p role="alert" className="text-[13px] text-destructive">{t("lawoss.yolo.load_failed", props.locale)}</p>
          : !props.canWrite ? <p className="text-[13px] text-muted-foreground">{t("lawoss.yolo.host_only", props.locale)}</p> : null}
        {props.failed ? <p role="alert" className="text-[13px] text-destructive">{t("lawoss.yolo.save_failed", props.locale)}</p> : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

/** Settings → Safety. `onChanged` uses the panel's existing engine-reload contract. */
export function YoloModeRow({ client, onChanged }: { client: LegalworkServerClient | null; onChanged: () => void }) {
  const mode = useYoloMode();
  const [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false), [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    if (!client) return;
    let active = true;
    void loadYoloMode(client).then((next) => { if (active) { publishYoloMode(next); setLoadFailed(false); } })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [client]);
  const save = async (enabled: boolean) => {
    if (!client) return;
    setBusy(true); setFailed(false);
    try { publishYoloMode(await saveYoloMode(client, enabled)); setConfirming(false); onChanged(); }
    catch { setFailed(true); } finally { setBusy(false); }
  };
  return <YoloModeRowView locale={currentLocale()} mode={mode} canWrite={Boolean(client?.canApprove)} busy={busy} confirming={confirming}
    failed={failed} loadFailed={loadFailed}
    onRequestChange={(enabled) => { if (requestYoloChange(enabled) === "confirm") setConfirming(true); else void save(false); }}
    onConfirm={() => void save(true)} onCancel={() => setConfirming(false)} />;
}

export function YoloBadgeView({ mode }: { mode: YoloMode | null }) {
  if (!mode?.enabled) return null;
  const title = t("lawoss.yolo.badge_title");
  return (
    <span data-lawoss-yolo-badge="" role="status" title={title} aria-label={title}
      className="inline-flex h-6 items-center rounded-full bg-red-3 px-2 text-[11px] font-semibold tracking-wide text-red-11">
      {t("lawoss.yolo.badge")}
    </span>
  );
}

const BADGE_REFRESH_MS = 15_000;

/** Beside the composer's model controls: visible only while YOLO Mode is on. The state is
 * read on mount and refreshed, so a server that answers late (cold start) still shows it. */
export function YoloBadge() {
  const mode = useYoloMode();
  useEffect(() => {
    let active = true;
    const refresh = () => void resolveLegalworkConnection().then(async (connection) => {
      if (!connection.normalizedBaseUrl) return;
      const client = createLegalworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken });
      const next = await loadYoloMode(client);
      if (active) publishYoloMode(next);
    }).catch(() => { /* Retried on the next refresh; Settings shows a load failure. */ });
    refresh();
    const timer = setInterval(refresh, BADGE_REFRESH_MS);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <YoloBadgeView mode={mode} />;
}
