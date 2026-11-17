/** @jsxImportSource react */
import { useCallback, useRef, useState } from "react";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { t } from "@/i18n";
import type { LegalworkControlAction } from "@/react-app/shell/control/control-provider";

type PendingConfirmation = { actionId: string; label: string; settle: (confirmed: boolean) => void };

function isMissing(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

/** LAWOSS #511: argumenty, pre ktoré by akcia odmietla aj po súhlase, sa skontrolujú ešte pred dialógom. */
export function controlConfirmationArgsError(action: LegalworkControlAction, args: unknown): string | null {
  const values: Record<string, unknown> = args && typeof args === "object" ? { ...args } : {};
  for (const arg of action.args ?? []) {
    if (!arg.required) continue;
    if (arg.name === "confirmed" && arg.type === "boolean") {
      if (values.confirmed !== true) return t("control.needs_confirm");
    } else if (isMissing(values[arg.name])) {
      return `${arg.name} is required`;
    }
  }
  return null;
}

/**
 * LAWOSS #511: potvrdenie akcie ovládania appky v dialógu appky namiesto `window.confirm`,
 * ktoré v Electrone zablokuje celý renderer. Zrušenie volajúcim (`signal`) dialóg zavrie a vráti `false`.
 */
export function useControlConfirmation() {
  const pendingRef = useRef<PendingConfirmation | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  const confirm = useCallback((action: LegalworkControlAction, signal?: AbortSignal) => new Promise<boolean>((resolve) => {
    if (signal?.aborted) return resolve(false);
    const onAbort = () => request.settle(false);
    const request: PendingConfirmation = {
      actionId: action.id,
      label: action.label,
      settle: (confirmed) => {
        if (pendingRef.current !== request) return;
        pendingRef.current = null;
        signal?.removeEventListener("abort", onAbort);
        setPending(null);
        resolve(confirmed);
      },
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    pendingRef.current = request;
    setPending(request);
  }), []);

  const pendingActionId = useCallback(() => pendingRef.current?.actionId ?? null, []);

  const dialog = pending ? (
    <ConfirmModal
      open
      title={t("control.confirm_allow", { label: pending.label })}
      message=""
      confirmLabel={t("tool_permissions.action_allow")}
      cancelLabel={t("common.cancel")}
      onConfirm={() => pending.settle(true)}
      onCancel={() => pending.settle(false)}
    />
  ) : null;

  return { confirm, pendingActionId, dialog };
}
