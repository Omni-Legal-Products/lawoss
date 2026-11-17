/** @jsxImportSource react */
// LAWOSS #502: provider failures the user can fix in Settings get a translated card instead of the raw provider text.
import * as React from "react";
import type { UIMessage } from "ai";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export type ProviderErrorKind = "auth" | "no-route";
export type ProviderErrorNotice = { kind: ProviderErrorKind; detail: string };

const KIND_BY_ERROR_TYPE = new Map<string, ProviderErrorKind>([
  ["provider.auth", "auth"],
  ["ProviderAuthError", "auth"],
  ["provider.no-route", "no-route"],
]);

const TITLE_KEYS = {
  auth: "lawoss.provider_error.auth",
  "no-route": "session_route.model_unavailable",
} as const satisfies Record<ProviderErrorKind, string>;

/** Engine v2 `type` (`provider.auth`) or v1 `name` (`ProviderAuthError`). */
export function providerErrorKind(type: string | null): ProviderErrorKind | null {
  return (type && KIND_BY_ERROR_TYPE.get(type)) || null;
}

export function providerErrorTitle(kind: ProviderErrorKind) {
  return t(TITLE_KEYS[kind]);
}

function isKind(value: unknown): value is ProviderErrorKind {
  return value === "auth" || value === "no-route";
}

/** Reads the notice that `createSessionErrorUIMessage` stores in message metadata. */
export function providerErrorNoticeOf(message: UIMessage): ProviderErrorNotice | null {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object" || !("opencode" in metadata)) return null;
  const opencode = metadata.opencode;
  if (!opencode || typeof opencode !== "object" || !("providerError" in opencode)) return null;
  const notice = opencode.providerError;
  if (!notice || typeof notice !== "object" || !("kind" in notice) || !("detail" in notice)) return null;
  return isKind(notice.kind) && typeof notice.detail === "string" ? { kind: notice.kind, detail: notice.detail } : null;
}

export const OpenAiSettingsContext = React.createContext<(() => void) | null>(null);

export function ProviderErrorCard({ notice }: { notice: ProviderErrorNotice }) {
  const openSettings = React.useContext(OpenAiSettingsContext);
  return (
    <div role="alert" className="flex w-full min-w-0 flex-col gap-2 rounded-lg border-2 border-red-300 bg-red-300/20 px-3 py-2">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
        <p className="text-sm text-foreground">{providerErrorTitle(notice.kind)}</p>
      </div>
      {openSettings ? (
        <div className="ml-6">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openSettings}>
            {t("lawoss.provider_error.open_settings")}
          </Button>
        </div>
      ) : null}
      {notice.detail ? (
        <details className="ml-6 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">{t("lawoss.provider_error.details")}</summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{notice.detail}</p>
        </details>
      ) : null}
    </div>
  );
}
