import type { Info } from "@opencode/plugin/promise/tool";

/**
 * LAWOSS #472: engine 2.1.4 offers a plugin tool to the model by name only with `codemode: false`
 * (`packages/core/src/tool.ts` snapshot); otherwise it exists only inside Code Mode `execute`, and a direct call ends
 * with "No tool named … is currently available". The LAWOSS tools that the fixed system texts tell the model to call
 * by name are offered directly, next to the engine's own read, write and edit, which the model would otherwise use.
 */
export function directTool(tool: Info): Info {
  const permission = tool.options?.permission, namespace = tool.options?.namespace;
  // A direct tool is never pinned in the Code Mode catalog.
  return { ...tool, options: { codemode: false, ...permission === undefined ? {} : { permission }, ...namespace === undefined ? {} : { namespace } } };
}

/**
 * LAWOSS #578: jadro editora dokumentov (`legalwork-extensions-preview`), ktoré vodítko, pravidlá Wordu a skill
 * `docx-edit` volajú menom ako prvé: príprava a výber dokumentu, čítanie DOCX, navrhnutá zmena, komentáre a sledované
 * zmeny. Definície týchto 12 nástrojov idú v každej požiadavke (v požiadavke enginu 11 192 znakov, asi 2 800 tokenov).
 * Ostatné nástroje `inapp_*` (`inapp_docx_edit` má sám vyše 9 000 znakov, PPTX, XLSX, Markdown) ostávajú v Code Mode
 * a texty ich volajú ako `tools.inapp_…` vnútri `execute`; stráži to `lawoss/plugin-text-direct-tools.test.ts`.
 */
const DIRECT_EDITOR_TOOLS: ReadonlySet<string> = new Set([
  "inapp_documents_open", "inapp_documents_list", "inapp_documents_select",
  "inapp_docx_read_document", "inapp_docx_find_text", "inapp_docx_suggest_change",
  "inapp_docx_add_comment", "inapp_docx_read_comments", "inapp_docx_reply_comment",
  "inapp_docx_read_changes", "inapp_docx_accept_changes", "inapp_docx_reject_changes",
]);

export function editorTool(tool: Info): Info {
  return DIRECT_EDITOR_TOOLS.has(tool.name) ? directTool(tool) : tool;
}
