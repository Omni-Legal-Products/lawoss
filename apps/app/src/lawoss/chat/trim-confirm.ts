/**
 * LAWOSS: pravdivé potvrdenie pred skrátením rozhovoru (N-A7-9, rozhodnutie MČ 28. 10. 2026, variant C).
 *
 * Upstream tlačidlo „Vrátiť späť“ volá `session.revert` enginu. Engine vracia súbory len v git
 * projekte (snapshot), priečinky klientov git nie sú, takže sa len skráti rozhovor a súbory ostanú.
 * Tlačidlo sa preto volá „Skrátiť rozhovor odtiaľto“ a pred skrátením sa appka opýta s pravdivým
 * textom: odstránené správy sa nedajú obnoviť a súbory sa nezmenia. Ponúkne aj rozvetvenie do nového
 * chatu, kde pôvodný rozhovor ostane celý. „Upraviť správu“ skracuje rozhovor rovnako, preto dostane
 * to isté potvrdenie s vlastným textom.
 *
 * Vrátenie zmien súborov (variant B) príde samostatne ako „Vrátiť túto zmenu“ na karte zmeny súborov.
 */
import type { UIMessage } from "ai";
import { t } from "@/i18n";
import { fileChangesOf } from "./file-changes";

export type ChatTrimMode = "trim" | "edit";
export type ChatTrimChoice = "cancel" | "fork" | "trim";

export type ChatTrimRequest = { mode: ChatTrimMode; question: string; fileChanges: number };

type PendingConfirm = ChatTrimRequest & { resolve: (choice: ChatTrimChoice) => void };

const QUESTION_PREVIEW_LENGTH = 60;

/**
 * Nástroje, ktorých hotové volanie mení súbory: úpravy enginu, `lawoss_files`, zápis pamäte
 * a zapisujúce akcie editora dokumentov. Príkazy v shelli sa nerátajú, ich účinok appka nepozná.
 */
const FILE_CHANGING_TOOLS = new Set([
  "edit",
  "write",
  "patch",
  "apply_patch",
  "multiedit",
  "lawoss_files",
  "lawoss_memory_write",
  "inapp_markdown_create",
  "inapp_md_replace_text",
  "inapp_md_save",
  "inapp_office_save",
  "inapp_docx_edit",
  "inapp_docx_fill_template",
  "inapp_docx_suggest_change",
  "inapp_docx_accept_changes",
  "inapp_docx_reject_changes",
  "inapp_docx_add_comment",
  "inapp_docx_reply_comment",
  "inapp_xlsx_write",
  "inapp_pptx_add_slide",
  "inapp_pptx_replace_text",
  "inapp_pptx_update_layout",
]);

/** Otázka, od ktorej engine reže prepis: kliknutá otázka, pri odpovedi otázka nad ňou. */
function boundaryIndex(messages: readonly UIMessage[], messageId: string): number {
  const index = messages.findIndex((message) => message.id === messageId);
  for (let current = index; current >= 0; current -= 1) {
    if (messages[current]?.role === "user") return current;
  }
  return index;
}

function questionPreview(message: UIMessage | undefined): string {
  const text = (message?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > QUESTION_PREVIEW_LENGTH ? `${text.slice(0, QUESTION_PREVIEW_LENGTH).trimEnd()}…` : text;
}

function countFileChanges(messages: readonly UIMessage[]): number {
  let count = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      // N-A8-5: dávka `lawoss_files` sa ráta po vykonaných zmenách (`file-changes.ts`).
      if (part.type === "dynamic-tool" && part.state === "output-available" && FILE_CHANGING_TOOLS.has(part.toolName))
        count += fileChangesOf(part.toolName, part.input, part.output);
    }
  }
  return count;
}

/**
 * Čo skrátenie od `messageId` odstráni. `boundaryId` je prvá odstránená otázka; rozvetvenie s ním
 * skopíruje rozhovor po ňu (engine kopíruje správy pred daným id), teda už skrátený rozhovor.
 */
export function chatTrimSummary(messages: readonly UIMessage[], messageId: string): ChatTrimRequest & { boundaryId: string } {
  const index = boundaryIndex(messages, messageId);
  const boundary = index >= 0 ? messages[index] : undefined;
  return {
    mode: "trim",
    boundaryId: boundary?.id ?? messageId,
    question: questionPreview(boundary),
    fileChanges: index >= 0 ? countFileChanges(messages.slice(index)) : 0,
  };
}

export function chatTrimCopy({ mode, question, fileChanges }: ChatTrimRequest) {
  const edit = mode === "edit";
  return {
    title: t(edit ? "lawoss.chat.trim.edit_title" : "lawoss.chat.trim.title"),
    description: edit
      ? t("lawoss.chat.trim.edit_description")
      : question
        ? t("lawoss.chat.trim.description", undefined, { question })
        : t("lawoss.chat.trim.description_no_question"),
    files: t("lawoss.chat.trim.files_unchanged"),
    changed: fileChanges > 0 ? t("lawoss.chat.trim.files_changed", { count: fileChanges }) : null,
    hint: edit ? null : t("lawoss.chat.trim.fork_hint"),
    cancel: t("lawoss.chat.trim.cancel"),
    fork: edit ? null : t("message_list.branch_in_new_chat"),
    confirm: t(edit ? "lawoss.chat.trim.edit_confirm" : "lawoss.chat.trim.confirm"),
  };
}

let pending: PendingConfirm | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Otvorí potvrdenie v ChatTrimConfirmHost; bez hostiteľa použije natívne okno (bez rozvetvenia). */
export function requestChatTrimConfirm(request: ChatTrimRequest): Promise<ChatTrimChoice> {
  if (!hosts) {
    const copy = chatTrimCopy(request);
    const text = [copy.title, copy.description, copy.files, copy.changed].filter(Boolean).join("\n\n");
    return Promise.resolve(typeof window !== "undefined" && window.confirm(text) ? "trim" : "cancel");
  }
  pending?.resolve("cancel");
  return new Promise((resolve) => {
    pending = { ...request, resolve };
    emit();
  });
}

export function settleChatTrimConfirm(choice: ChatTrimChoice): void {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(choice);
}

export const chatTrimConfirmStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: (): ChatTrimRequest | null => pending,
  attachHost() {
    hosts += 1;
    return () => {
      hosts -= 1;
      if (!hosts) settleChatTrimConfirm("cancel");
    };
  },
};

/**
 * Opýta sa pred skrátením rozhovoru od `messageId`. Vráti voľbu a prvú odstránenú otázku
 * (`boundaryId`) pre rozvetvenie do nového chatu.
 */
export async function confirmChatTrim(
  messages: readonly UIMessage[],
  messageId: string,
  mode: ChatTrimMode,
  confirm: (request: ChatTrimRequest) => Promise<ChatTrimChoice> = requestChatTrimConfirm,
): Promise<{ choice: ChatTrimChoice; boundaryId: string }> {
  const { boundaryId, ...summary } = chatTrimSummary(messages, messageId);
  const choice = await confirm({ ...summary, mode });
  return { choice: mode === "edit" && choice === "fork" ? "cancel" : choice, boundaryId };
}

export const chatTrimDoneMessage = () => t("lawoss.chat.trim.done");
