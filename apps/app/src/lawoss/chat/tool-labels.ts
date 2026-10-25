/**
 * LAWOSS: kroky agenta po slovensky pre advokáta, nie názvy nástrojov (N-A5-7, test 25. 10. 2026). Bez tohto
 * súboru appka ukazovala „Spúšťanie lawoss documents prepare“, „Lawoss files“, „Project remote folders“,
 * „Spúšťanie legalwork shell“, „Čítanie ses_….md“ a „Čítanie cloudového súboru“ aj pri lokálnom priečinku.
 * Volá ho `lib/tool-activity.ts` (počas behu) a `components/tools/tool-presentation.ts` (po skončení), PATCHES.md.
 */
import { t } from "@/i18n";

type Labels = { active: string; done: string };

/** Statická mapa kľúčov (i18n audit odmieta skladané kľúče). */
const TOOL_LABELS: Record<string, Labels> = {
  lawoss_documents_prepare: { active: "lawoss.tool.documents_prepare", done: "lawoss.tool.documents_prepare_done" },
  lawoss_documents_list: { active: "lawoss.tool.documents_list", done: "lawoss.tool.documents_list_done" },
  lawoss_documents_read: { active: "lawoss.tool.documents_read", done: "lawoss.tool.documents_read_done" },
  lawoss_documents_export: { active: "lawoss.tool.documents_export", done: "lawoss.tool.documents_export_done" },
  lawoss_documents_validate: { active: "lawoss.tool.documents_validate", done: "lawoss.tool.documents_validate_done" },
  lawoss_files: { active: "lawoss.tool.files", done: "lawoss.tool.files_done" },
  // Čítanie pamäte prípadu: tie isté texty ako doteraz (N-A3-3).
  lawoss_memory: { active: "tool_activity.reading_project_content", done: "tool_run.summary.read" },
  legalwork_project_remote_folders: { active: "lawoss.tool.linked_folders", done: "lawoss.tool.linked_folders_done" },
  // Pripojené priečinky klienta sú často lokálne: nie „cloudový súbor“.
  storage_read_file: { active: "lawoss.tool.file_read", done: "lawoss.tool.file_read_done" },
  storage_list_folder: { active: "lawoss.tool.folder_browse", done: "lawoss.tool.folder_browse_done" },
  storage_search: { active: "lawoss.tool.files_search", done: "lawoss.tool.files_search_done" },
  storage_search_filenames: { active: "lawoss.tool.files_search", done: "lawoss.tool.files_search_done" },
  storage_write_file: { active: "lawoss.tool.file_save", done: "lawoss.tool.file_save_done" },
  legalwork_shell: { active: "tool_activity.running_command", done: "tool_run.ran_command" },
};

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const field = (input: unknown, key: string): string | undefined => input && typeof input === "object" ? text(Reflect.get(input, key)) : undefined;

/** Prepis chatu (`ses_….md`) je predchádzajúci rozhovor, nie súbor s menom identifikátora. */
const SESSION_FILE = /(?:^|[\\/])ses_[A-Za-z0-9]+\.md$/;

function label(name: string, input: unknown, phase: keyof Labels): string | null {
  if (name === "read" && SESSION_FILE.test(field(input, "filePath") ?? "")) return t(phase === "active" ? "lawoss.tool.session_read" : "lawoss.tool.session_read_done");
  const labels = TOOL_LABELS[name];
  if (labels) {
    // Príkaz s popisom od agenta ukáže popis, ako pri bežnom príkaze.
    if (name === "legalwork_shell" && field(input, "description")) return null;
    return t(labels[phase]);
  }
  // Iný nástroj LAWOSS bez vlastného textu: všeobecný krok, nikdy názov nástroja.
  return name.startsWith("lawoss_") ? t("tool.working") : null;
}

/** Krok počas behu, alebo `null`, keď má nástroj upstream text. */
export const lawossToolActivityLabel = (name: string, input: unknown): string | null => label(name, input, "active");
/** Krok po skončení, alebo `null`, keď má nástroj upstream text. */
export const lawossToolHistoryLabel = (name: string, input: unknown): string | null => label(name, input, "done");
