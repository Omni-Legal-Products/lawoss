/**
 * LAWOSS: karta nástroja `lawoss_memory_write` (N-A7-10, test 28. 10. 2026; MČ 23. 10. 2026: zápis s kartou „čo a kam“).
 * Namiesto štyroch kariet „Spustiť príkaz v počítači?“ s kódom `node …` advokát vidí jednu kartu „Zapísať do pamäte
 * prípadu?“ so zapisovaným textom a súborom relatívne ku klientovi. Náhľad prichádza zo servera
 * (`apps/server/src/lawoss/matter-memory.ts`) v `metadata.lawossMemory` karty enginu (povolenie `lawoss_file_change`).
 */
import { t } from "@/i18n";
import type { FileOperationDetails } from "./file-operation-card";

type MemoryWrite = { target: string; truth: string; previousTruth?: string; history: string[]; fields: string[]; reason?: string };

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;

function memoryWrite(metadata: Record<string, unknown>): MemoryWrite | null {
  const raw: unknown = metadata.lawossMemory;
  if (!raw || typeof raw !== "object") return null;
  const target: unknown = Reflect.get(raw, "target"), truth: unknown = Reflect.get(raw, "truth");
  const previous: unknown = Reflect.get(raw, "previousTruth"), reason: unknown = Reflect.get(raw, "reason");
  const history = strings(Reflect.get(raw, "history")), fields = strings(Reflect.get(raw, "fields"));
  if (typeof target !== "string" || !target || typeof truth !== "string" || !history || !fields) return null;
  return { target, truth, history, fields, ...(typeof previous === "string" ? { previousTruth: previous } : {}),
    ...(typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {}) };
}

/** The card's readable content, or `null` when the request is not from `lawoss_memory_write`. */
export function memoryWriteCard(metadata: Record<string, unknown>): { title: string; message: string; permissionLabel: string; scopeLabel: string; scopeValue: string; details: FileOperationDetails } | null {
  const write = memoryWrite(metadata);
  if (!write) return null;
  const file = t("lawoss.memory_write.file", undefined, { path: write.target }), text = t("lawoss.memory_write.text", undefined, { text: write.truth });
  const added = [...write.history.map((text) => t("lawoss.memory_write.history", undefined, { text })),
    ...write.fields.map((text) => t("lawoss.memory_write.field", undefined, { text }))];
  return {
    title: t("lawoss.memory_write.title"),
    message: t("lawoss.memory_write.message"),
    permissionLabel: t("lawoss.memory_write.permission_label"),
    scopeLabel: t("lawoss.memory_write.scope"),
    scopeValue: [file, text, ...added].join("\n"),
    details: {
      reason: write.reason ? t("lawoss.files.reason", undefined, { text: write.reason }) : null,
      lines: [file, ...(write.previousTruth === undefined ? [] : [t("lawoss.memory_write.previous", undefined, { text: write.previousTruth })]), text, ...added],
    },
  };
}
