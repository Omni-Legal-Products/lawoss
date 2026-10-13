import { describe, expect, it } from "bun:test";

import {
  parseSpreadsheet,
  serializeSpreadsheet,
} from "../src/react-app/domains/session/artifacts/artifact-spreadsheet-model";

describe("artifact spreadsheet model", () => {
  it.each(["#", "?"])("round-trips CSV and TSV filenames containing %s", async (marker) => {
    for (const [extension, delimiter] of [["CSV", ","], ["TSV", "\t"]]) {
      const name = `Revenue.docx_${marker}a1b2c3d4.${extension}`;
      const data = `name${delimiter}revenue\nAda${delimiter}10\n`;
      const rows = await parseSpreadsheet({ name, content: { kind: "text", data } });
      expect(rows).toEqual([["name", "revenue"], ["Ada", "10"]]);
      rows[1]![1] = "11";
      expect(await serializeSpreadsheet(name, rows)).toEqual({
        kind: "text", data: `name${delimiter}revenue\nAda${delimiter}11\n`,
      });
    }
  });

  it("round-trips CSV edits", async () => {
    const rows = await parseSpreadsheet({ name: "artifact-eval.csv", content: { kind: "text", data: "name,revenue\nAda,10\n" } });
    rows[1]![1] = "11";
    const output = await serializeSpreadsheet("artifact-eval.csv", rows);
    expect(output).toEqual({ kind: "text", data: "name,revenue\nAda,11\n" });
  });

  it("round-trips XLSX edits", async () => {
    const output = await serializeSpreadsheet("artifact-eval.xlsx", [["name", "revenue"], ["Ada", "10"]]);
    expect(output.kind).toBe("binary");
    if (output.kind !== "binary") throw new Error("expected binary");
    const parsed = await parseSpreadsheet({ name: "artifact-eval.xlsx", content: output });
    expect(parsed.slice(0, 2)).toEqual([["name", "revenue"], ["Ada", "10"]]);
  });
});
