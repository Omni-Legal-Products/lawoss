import type { CustomProviderApiType } from "./store";
import { t } from "@/i18n";
import { isLocalRuntimeEndpoint, LOCAL_RUNTIME_BASE_URLS } from "@legalwork/types/local-runtime-endpoints";

/**
 * A one-click starting point for a local model server. Picking a template
 * pre-fills the custom provider form (Base URL, name, API type) for that
 * runtime; the user then fetches models and connects. All local runtimes speak
 * the OpenAI /v1/chat/completions spec, so they route through
 * `@ai-sdk/openai-compatible` with no API key.
 */
export type LocalRuntimeTemplate = {
  /** Stable template key (also the suggested provider id / name slug). */
  id: string;
  label: string;
  /** Display name prefilled into the form. */
  name: string;
  /** Base URL prefilled into the form. */
  baseURL: string;
  /** Base URL placeholder shown when the field is blank. */
  placeholder: string;
  apiType: CustomProviderApiType;
  /** Shown under the picker when this template is active. */
  note: string;
  /**
   * Highlights the note for runtimes with separate automatic setup.
   * LM Studio uses explicit endpoint discovery and does not set this flag.
   */
  autoDetected?: boolean;
};

/**
 * Built per call, not once at import: `t()` reads the current language, so a
 * module-level constant would freeze these notes in whatever language loaded first.
 */
export const localRuntimeTemplates = (): LocalRuntimeTemplate[] => [
  {
    id: "llamacpp",
    label: "llama.cpp",
    name: "llama.cpp",
    baseURL: LOCAL_RUNTIME_BASE_URLS.llamacpp,
    placeholder: LOCAL_RUNTIME_BASE_URLS.llamacpp,
    apiType: "chat",
    note: t("local_templates.llamacpp_hint"),
  },
  {
    id: "vllm",
    label: "vLLM",
    name: "vLLM",
    baseURL: LOCAL_RUNTIME_BASE_URLS.vllm,
    placeholder: LOCAL_RUNTIME_BASE_URLS.vllm,
    apiType: "chat",
    note: t("local_templates.vllm_note"),
  },
  {
    id: "localai",
    label: "LocalAI",
    name: "LocalAI",
    baseURL: LOCAL_RUNTIME_BASE_URLS.localai,
    placeholder: LOCAL_RUNTIME_BASE_URLS.localai,
    apiType: "chat",
    note: t("local_templates.localai_note"),
  },
  {
    id: "ollama",
    label: "Ollama",
    name: "Ollama",
    baseURL: LOCAL_RUNTIME_BASE_URLS.ollama,
    placeholder: LOCAL_RUNTIME_BASE_URLS.ollama,
    apiType: "chat",
    autoDetected: true,
    note: t("local_templates.ollama_note"),
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    name: "LM Studio",
    baseURL: LOCAL_RUNTIME_BASE_URLS.lmstudio,
    placeholder: LOCAL_RUNTIME_BASE_URLS.lmstudio,
    apiType: "chat",
    note: t("local_templates.lmstudio_note"),
  },
];

/** Local templates speak Chat Completions, including when editing a redacted saved endpoint. */
export function localRuntimeRequiresChat(baseURL: string, templateId?: string | null): boolean {
  return localRuntimeTemplates().some((template) => template.id === templateId || slugifyProviderId(template.name) === templateId)
    || isLocalRuntimeEndpoint(baseURL);
}

/** Turn a free-text provider name into a stable lowercase provider id. */
export function slugifyProviderId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom-provider";
}

/**
 * The display name to use after picking a template. We replace the current
 * value only when it's blank or still a template default, so a name the user
 * typed themselves is preserved when switching between templates.
 */
export function resolveTemplateName(
  currentName: string,
  template: LocalRuntimeTemplate,
  templates: LocalRuntimeTemplate[] = localRuntimeTemplates(),
): string {
  const trimmed = currentName.trim();
  const isTemplateName = templates.some((candidate) => candidate.name === trimmed);
  return !trimmed || isTemplateName ? template.name : currentName;
}
