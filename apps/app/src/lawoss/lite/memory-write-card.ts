/**
 * LAWOSS: karta nástroja `lawoss_memory_write` (N-A7-10, test 28. 10. 2026; MČ 23. 10. 2026: zápis s kartou „čo a kam“).
 * Namiesto štyroch kariet „Spustiť príkaz v počítači?“ s kódom `node …` advokát vidí jednu kartu „Zapísať do pamäte
 * prípadu?“ so zapisovaným textom a súborom relatívne ku klientovi. Náhľad prichádza zo servera
 * (`apps/server/src/lawoss/matter-memory.ts`) v `metadata.lawossMemory` karty enginu (povolenie `lawoss_file_change`).
 *
 * Rozhodnutia MČ 10. 11. 2026: poznámka pre celého klienta (`scope: "client"`) má vlastný nadpis a riadok „Platí pre
 * celého klienta“; lehota z pokynu advokáta (`deadline`, nástroj `lawoss_memory_deadline`) ukáže prípad, dátum, na čo je,
 * označenie „podľa pokynu advokáta, neoverené z listiny“ a oba súbory, do ktorých sa zapíše.
 *
 * Overenie alfy 14. 11. 2026: „pripomeň mi do 25. 11. … zapíš to ako úlohu“ je pracovná úloha s termínom `due`, nie
 * procesná lehota. Nový záznam typu `task` s platným `due` a bez `deadlines` (nástroj `lawoss_memory_write`) má kartu
 * „Zapísať úlohu do prípadu?“ s úlohou a termínom; iná úloha (zmena, lehota, chybný dátum) ostáva na všeobecnej karte.
 */
import { currentLocale, t } from "@/i18n";
import type { FileOperationDetails } from "./file-operation-card";

type Deadline = { case: string; date: string; what: string; register: string };
/** #417: a new task of a case is registered among the case's inputs like a deadline, with the lawyer's sentence. */
type Task = { case: string; register: string; instruction?: string };
type MemoryWrite = { target: string; kind: "create" | "update"; title: string; type: string; truth: string; previousTruth?: string; history: string[]; fields: string[]; reason?: string; client?: true; deadline?: Deadline; task?: Task };

/** The deadline's part of the preview; incomplete data gives no deadline card (the plain memory card still shows the record). */
function deadlineOf(raw: unknown): Deadline | null {
  if (!raw || typeof raw !== "object") return null;
  const name: unknown = Reflect.get(raw, "case"), date: unknown = Reflect.get(raw, "date"), what: unknown = Reflect.get(raw, "what"), register: unknown = Reflect.get(raw, "register");
  if (typeof name !== "string" || typeof date !== "string" || typeof what !== "string" || typeof register !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || !what || !register) return null;
  return { case: name, date, what, register };
}

/** The task's case, register and the sentence registered there; incomplete data gives no such lines. */
function taskOf(raw: unknown): Task | null {
  if (!raw || typeof raw !== "object") return null;
  const name: unknown = Reflect.get(raw, "case"), register: unknown = Reflect.get(raw, "register"), said: unknown = Reflect.get(raw, "instruction");
  if (typeof name !== "string" || !name || typeof register !== "string" || !register) return null;
  return { case: name, register, ...(typeof said === "string" && said.trim() ? { instruction: said.trim() } : {}) };
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
  const kind: unknown = Reflect.get(raw, "kind"), title: unknown = Reflect.get(raw, "title"), type: unknown = Reflect.get(raw, "type");
  const previous: unknown = Reflect.get(raw, "previousTruth"), reason: unknown = Reflect.get(raw, "reason");
  const history = strings(Reflect.get(raw, "history")), fields = strings(Reflect.get(raw, "fields"));
  if (typeof target !== "string" || !target || typeof truth !== "string" || !history || !fields) return null;
  if ((kind !== "create" && kind !== "update") || typeof title !== "string") return null;
  const deadline = deadlineOf(Reflect.get(raw, "deadline")), task = taskOf(Reflect.get(raw, "task"));
  return { target, kind, title, type: typeof type === "string" ? type : "", truth, history, fields, ...(typeof previous === "string" ? { previousTruth: previous } : {}),
    ...(typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {}),
    ...(Reflect.get(raw, "scope") === "client" ? { client: true as const } : {}), ...(deadline ? { deadline } : {}), ...(task ? { task } : {}) };
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

/**
 * The term of a new task record: its `due` field as a real calendar day (`due: 2026-11-25`, optionally with a note),
 * and no `deadlines` (a procedural deadline keeps the plain card). `null` when it is not such a task.
 */
function taskDue(write: MemoryWrite): string | null {
  if (write.kind !== "create" || write.type !== "task" || write.client || write.deadline) return null;
  if (write.fields.some((field) => field.startsWith("deadlines:"))) return null;
  const due = write.fields.filter((field) => field.startsWith("due:"));
  const day = due.length === 1 ? /^due: (\d{4}-\d{2}-\d{2})(?:$|[ T])/.exec(due[0]!)?.[1] : undefined;
  const parsed = day ? new Date(`${day}T00:00:00Z`) : null;
  return parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

/** The case by name and the register that gets the instruction's row, with the same words as a deadline (#417). */
const taskCase = (write: MemoryWrite): string[] => write.task ? [t("lawoss.memory_write.deadline_case", undefined, { name: write.task.case })] : [];
/** The register line also quotes the sentence that becomes the row, so the lawyer sees what is recorded as the instruction. */
const taskRegister = (write: MemoryWrite): string[] => !write.task ? [] : [write.task.instruction
  ? t("lawoss.memory_write.task_register", undefined, { text: write.task.instruction, path: write.task.register })
  : t("lawoss.memory_write.deadline_register", undefined, { path: write.task.register })];

/** One card for the lawyer's task: the case, what to do, by when, the files and every field of the new record. */
function taskCard(write: MemoryWrite, due: string): Card {
  const lines = [
    ...taskCase(write),
    t("lawoss.memory_write.task_what", undefined, { text: write.title }),
    t("lawoss.memory_write.task_due", undefined, { date: fullDay(due) }),
    t("lawoss.memory_write.file", undefined, { path: write.target }),
    ...taskRegister(write),
    t("lawoss.memory_write.text", undefined, { text: write.truth }),
    ...write.history.map((text) => t("lawoss.memory_write.history", undefined, { text })),
    ...write.fields.map((text) => t("lawoss.memory_write.field_new", undefined, { text })),
  ];
  return {
    title: t("lawoss.memory_write.task_title"), message: t("lawoss.memory_write.task_message"),
    permissionLabel: t("lawoss.memory_write.permission_label"), scopeLabel: t("lawoss.memory_write.scope"),
    scopeValue: lines.join("\n"),
    details: { reason: write.reason ? t("lawoss.files.reason", undefined, { text: write.reason }) : null, lines },
  };
}

/** The card's readable content, or `null` when the request is not from `lawoss_memory_write`. */
export function memoryWriteCard(metadata: Record<string, unknown>): Card | null {
  const write = memoryWrite(metadata);
  if (!write) return null;
  if (write.deadline) return deadlineCard(write, write.deadline);
  const due = taskDue(write);
  if (due) return taskCard(write, due);
  // A note for the whole client says so in plain words before the file.
  const whole = write.client ? [t("lawoss.memory_write.client_scope")] : taskCase(write);
  const file = [t("lawoss.memory_write.file", undefined, { path: write.target }), ...taskRegister(write)], text = t("lawoss.memory_write.text", undefined, { text: write.truth });
  // A new record shows every field it brings (also a subject's identifiers); a change shows the changed ones.
  const record = t(write.kind === "create" ? "lawoss.memory_write.record_new" : "lawoss.memory_write.record_change", undefined, { title: write.title });
  const added = [...write.history.map((text) => t("lawoss.memory_write.history", undefined, { text })),
    ...write.fields.map((text) => t(write.kind === "create" ? "lawoss.memory_write.field_new" : "lawoss.memory_write.field", undefined, { text }))];
  return {
    title: t(write.client ? "lawoss.memory_write.client_title" : "lawoss.memory_write.title"),
    message: t(write.client ? "lawoss.memory_write.client_message" : "lawoss.memory_write.message"),
    // Test alfy 10. 11.: karta poznámky ku klientovi písala „Pamäť prípadu“.
    permissionLabel: t(write.client ? "lawoss.memory_write.client_permission_label" : "lawoss.memory_write.permission_label"),
    scopeLabel: t("lawoss.memory_write.scope"),
    scopeValue: [...whole, ...file, record, text, ...added].join("\n"),
    details: {
      reason: write.reason ? t("lawoss.files.reason", undefined, { text: write.reason }) : null,
      lines: [...whole, ...file, record, ...(write.previousTruth === undefined ? [] : [t("lawoss.memory_write.previous", undefined, { text: write.previousTruth })]), text, ...added],
    },
  };
}
