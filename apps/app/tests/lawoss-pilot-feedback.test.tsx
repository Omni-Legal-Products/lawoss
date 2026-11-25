import { expect, test } from "bun:test";
import type { DynamicToolUIPart } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { writeMatterTitle } from "@/lawoss/lite/matter-title";
import { ToolSources } from "@/lawoss/chat/tool-sources";
import { parseFrontmatter } from "../../../lawoss/okf/src/frontmatter";

test("renaming edits only the selected card title and guards the exact revision", async () => {
  const content = '\ufeff---\r\ntitle: "Old"\r\nother: 1\r\n---\r\n# Old\n';
  const title = 'Zmluva "A": $&';
  let writes = 0;
  const client = {
    async readWorkspaceFile() { return { path: "matter.md", content, bytes: content.length, updatedAt: 1 }; },
    async writeWorkspaceFile(workspace: string, update: { path: string; content: string; expectedContent?: string | null }) {
      expect(workspace).toBe("workspace");
      expect(update.path).toBe("matter.md");
      expect(update.expectedContent).toBe(content);
      expect(update.content).toBe(content.replace('"Old"', () => JSON.stringify(title)));
      expect(parseFrontmatter(update.content)?.title).toBe(title);
      writes++;
      return { path: update.path, bytes: update.content.length, updatedAt: 2, ok: true as const };
    },
  };
  await writeMatterTitle(client, "workspace", "matter.md", { title: "Old", cardPath: "matter.md" }, title);
  await expect(writeMatterTitle(client, "workspace", "matter.md", { title: "Changed", cardPath: "matter.md" }, title)).rejects.toThrow("case_changed");
  await expect(writeMatterTitle(client, "workspace", "matter.md", { title: "Old" }, "x\ny")).rejects.toThrow("invalid_title");
  expect(writes).toBe(1);
});

test("sources use individual nested receipts, including errors, without trusting code or output", () => {
  const tool: DynamicToolUIPart = { type: "dynamic-tool", toolName: "execute", toolCallId: "1", state: "output-available",
    input: { code: "tools.orsr.search()" }, output: "slovlex_get_law",
    callProviderMetadata: { opencode: { executedTools: ["judikaty.search_decisions"], failedTools: ["judikaty.search_decisions"] } } };
  const html = renderToStaticMarkup(<ToolSources tools={[tool]} />);
  expect(html).toContain("Slovak case law");
  expect(html).not.toContain("Slov-Lex");
  expect(html).not.toContain("orsr");
  expect(renderToStaticMarkup(<ToolSources tools={[{ ...tool, callProviderMetadata: {} }]} />)).toBe("");
});

test("the Czech register sources retain distinct server identities and outcomes", () => {
  const tool: DynamicToolUIPart = { type: "dynamic-tool", toolName: "execute", toolCallId: "cz", state: "output-available",
    input: {}, output: {}, callProviderMetadata: { opencode: {
      executedTools: ["cz_ares.lookup", "cz_isir_search", "cz_ares.search"], failedTools: ["cz_adis.lookup"],
    } } };
  const html = renderToStaticMarkup(<ToolSources tools={[tool]} />);
  expect(html).toContain("ARES · ISIR");
  expect(html.match(/ARES/g)).toHaveLength(1);
  expect(html).toContain("ADIS");
});
