/**
 * LAWOSS: karta nástroja `lawoss_memory_write` (N-A7-10, test 28. 10. 2026; MČ 23. 10. 2026: zápis s kartou „čo a kam“).
 * Namiesto štyroch kariet „Spustiť príkaz v počítači?“ s kódom `node …` advokát vidí jednu kartu „Zapísať do pamäte
 * prípadu?“ so zapisovaným textom a súborom relatívne ku klientovi. Náhľad prichádza zo servera
 * (`apps/server/src/lawoss/matter-memory.ts`) v `metadata.lawossMemory` karty enginu (povolenie `lawoss_file_change`).
 *
 * Rozhodnutia MČ 10. 11. 2026: poznámka pre celého klienta (`scope: "client"`) má vlastný nadpis a riadok „Platí pre
 * celého klienta“; lehota z pokynu advokáta (`deadline`, nástroj `lawoss_memory_deadline`) ukáže prípad, dátum, na čo je,
 * označenie „podľa pokynu advokáta, neoverené z listiny“ a oba súbory, do ktorých sa zapíše.
 */
import { currentLocale, t } from "@/i18n";
import type { FileOperationDetails } from "./file-operation-card";

type Deadline = { case: string; date: string; what: string; register: string };
type MemoryWrite = { target: string; kind: "create" | "update"; title: string; truth: string; previousTruth?: string; history: string[]; fields: string[]; reason?: string; client?: true; deadline?: Deadline };

/** The deadline's part of the preview; incomplete data gives no deadline card (the plain memory card still shows the record). */
function deadlineOf(raw: unknown): Deadline | null {
  if (!raw || typeof raw !== "object") return null;
  const name: unknown = Reflect.get(raw, "case"), date: unknown = Reflect.get(raw, "date"), what: unknown = Reflect.get(raw, "what"), register: unknown = Reflect.get(raw, "register");
  if (typeof name !== "string" || typeof date !== "string" || typeof what !== "string" || typeof register !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || !what || !register) return null;
  return { case: name, date, what, register };
}

/** The whole date with its year (a deadline next year must not look like next week); the ISO day stays beside it. */
function fullDay(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return iso;
  return `${new Intl.DateTimeFormat(currentLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(day)} (${iso})`;
}

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;

function memoryWrite(metadata: Record<string, unknown>): MemoryWrite | null {
  const raw: unknown = metadata.lawossMemory;
  if (!raw || typeof raw !== "object") return null;
  const target: unknown = Reflect.get(raw, "target"), truth: unknown = Reflect.get(raw, "truth");
  const kind: unknown = Reflect.get(raw, "kind"), title: unknown = Reflect.get(raw, "title");
  const previous: unknown = Reflect.get(raw, "previousTruth"), reason: unknown = Reflect.get(raw, "reason");
  const history = strings(Reflect.get(raw, "history")), fields = strings(Reflect.get(raw, "fields"));
  if (typeof target !== "string" || !target || typeof truth !== "string" || !history || !fields) return null;
  if ((kind !== "create" && kind !== "update") || typeof title !== "string") return null;
  const deadline = deadlineOf(Reflect.get(raw, "deadline"));
  return { target, kind, title, truth, history, fields, ...(typeof previous === "string" ? { previousTruth: previous } : {}),
    ...(typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {}),
    ...(Reflect.get(raw, "scope") === "client" ? { client: true as const } : {}), ...(deadline ? { deadline } : {}) };
}

type Card = { title: string; message: string; permissionLabel: string; scopeLabel: string; scopeValue: string; details: FileOperationDetails };

/** One card for the lawyer's deadline: the case by name, the date, what it is for, the marker and both files. No record fields. */
function deadlineCard(write: MemoryWrite, deadline: Deadline): Card {
  const lines = [
    t("lawoss.memory_write.deadline_case", undefined, { name: deadline.case }),
    t("lawoss.memory_write.deadline_date", undefined, { date: fullDay(deadline.date) }),
    t("lawoss.memory_write.deadline_what", undefined, { text: deadline.what }),
    t("lawoss.memory_write.deadline_basis", undefined, { text: t("lawoss.lite.deadline_by_instruction") }),
    t("lawoss.memory_write.deadline_file", undefined, { path: write.target }),
    t("lawoss.memory_write.deadline_register", undefined, { path: deadline.register }),
    t("lawoss.memory_write.text", undefined, { text: write.truth }),
  ];
  return {
    title: t("lawoss.memory_write.deadline_title"), message: t("lawoss.memory_write.deadline_message"),
    permissionLabel: t("lawoss.memory_write.permission_label"), scopeLabel: t("lawoss.memory_write.scope"),
    scopeValue: lines.join("\n"), details: { reason: null, lines },
  };
}

/** The card's readable content, or `null` when the request is not from `lawoss_memory_write`. */
export function memoryWriteCard(metadata: Record<string, unknown>): Card | null {
  const write = memoryWrite(metadata);
  if (!write) return null;
  if (write.deadline) return deadlineCard(write, write.deadline);
  // A note for the whole client says so in plain words before the file.
  const whole = write.client ? [t("lawoss.memory_write.client_scope")] : [];
  const file = t("lawoss.memory_write.file", undefined, { path: write.target }), text = t("lawoss.memory_write.text", undefined, { text: write.truth });
  // A new record shows every field it brings (also a subject's identifiers); a change shows the changed ones.
  const record = t(write.kind === "create" ? "lawoss.memory_write.record_new" : "lawoss.memory_write.record_change", undefined, { title: write.title });
  const added = [...write.history.map((text) => t("lawoss.memory_write.history", undefined, { text })),
    ...write.fields.map((text) => t(write.kind === "create" ? "lawoss.memory_write.field_new" : "lawoss.memory_write.field", undefined, { text }))];
  return {
    title: t(write.client ? "lawoss.memory_write.client_title" : "lawoss.memory_write.title"),
    message: t(write.client ? "lawoss.memory_write.client_message" : "lawoss.memory_write.message"),
    permissionLabel: t("lawoss.memory_write.permission_label"),
    scopeLabel: t("lawoss.memory_write.scope"),
    scopeValue: [...whole, file, record, text, ...added].join("\n"),
    details: {
      reason: write.reason ? t("lawoss.files.reason", undefined, { text: write.reason }) : null,
      lines: [...whole, file, record, ...(write.previousTruth === undefined ? [] : [t("lawoss.memory_write.previous", undefined, { text: write.previousTruth })]), text, ...added],
    },
  };
}
