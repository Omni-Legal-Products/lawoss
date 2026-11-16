import { t } from "@/i18n";

/** Engine method IDs whose English labels LAWOSS translates (#502). */
const METHOD_LABEL_KEYS = {
  "chatgpt-token-sharing": "lawoss.provider_method.chatgpt_sign_in",
  "chatgpt-browser": "lawoss.provider_method.codex_browser",
  "chatgpt-headless": "lawoss.provider_method.codex_device",
} as const;

type Method = { type: string; label: string; methodID?: string };

function isKnownMethodID(id: string | undefined): id is keyof typeof METHOD_LABEL_KEYS {
  return id !== undefined && Object.hasOwn(METHOD_LABEL_KEYS, id);
}

/** Display label only; label-based checks (headless, pro/max) keep reading the engine label. */
export function providerMethodLabel(method: Method) {
  if (isKnownMethodID(method.methodID)) return t(METHOD_LABEL_KEYS[method.methodID]);
  return method.label || (method.type === "oauth" ? "OAuth" : t("providers.api_key_label"));
}
