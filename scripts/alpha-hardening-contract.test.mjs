import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("LAWOSS alpha hardening artifacts", () => {
  test("acceptance guide defines the golden path and safety boundaries", async () => {
    const guide = await read("docs/lawoss-alpha-acceptance.md");
    for (const phrase of [
      "klient → vec → dokument → pamäť → nový rozhovor",
      "syntetické alebo verejné dáta",
      "OpenAI",
      "Anthropic",
      "ľudské potvrdenie",
      "zdroj",
      "nie je právne, bezpečnostné ani produkčné schválenie",
    ]) {
      expect(guide).toContain(phrase);
    }
  });

  test("alpha issue form requires reproducible environment data and forbids protected data", async () => {
    const form = await read(".github/ISSUE_TEMPLATE/alpha-test-report.yml");
    for (const field of ["operating_system", "architecture", "node_version", "pnpm_version", "commit", "scenario", "expected", "actual"]) {
      expect(form).toContain(`id: ${field}`);
    }
    for (const warning of ["API keys", "tokens", "client identifiers", "client documents", "prompts"]) {
      expect(form).toContain(warning);
    }
  });
});
