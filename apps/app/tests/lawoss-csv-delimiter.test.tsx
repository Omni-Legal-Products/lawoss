import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLocale } from "../src/i18n";
import { parseSpreadsheet, serializeSpreadsheet } from "../src/react-app/domains/session/artifacts/artifact-spreadsheet-model";
import { ArtifactSpreadsheetEditor } from "../src/react-app/domains/session/artifacts/artifact-spreadsheet-editor";

// #493: CSV z Excelu v SK/CZ prostredí (bodkočiarka, desatinná čiarka) — syntetické dáta ako E024/E025.
const HODNOTY = "id;suma\nSYN-01;0\nSYN-02;\nSYN-03;-125,50\n";
const FORMULA = "meno;poznamka\nSYN klient;=1+1\nSYN klient 2;@SUM(1+1)\n";

const text = (data: string) => ({ kind: "text" as const, data });

async function roundTrip(name: string, data: string, edit?: (rows: string[][]) => void) {
  const rows = await parseSpreadsheet({ name, content: text(data) });
  edit?.(rows);
  return serializeSpreadsheet(name, rows, text(data));
}

describe("CSV oddeľovač (#493)", () => {
  it("bodkočiarka: stĺpce aj desatinná čiarka ostanú celé", async () => {
    expect(await parseSpreadsheet({ name: "hodnoty.csv", content: text(HODNOTY) })).toEqual([
      ["id", "suma"], ["SYN-01", "0"], ["SYN-02", ""], ["SYN-03", "-125,50"],
    ]);
    expect(await parseSpreadsheet({ name: "formula.csv", content: text(FORMULA) })).toEqual([
      ["meno", "poznamka"], ["SYN klient", "=1+1"], ["SYN klient 2", "@SUM(1+1)"],
    ]);
  });

  it("tabulátor a čiarka sa rozpoznajú podľa obsahu, úvodzovky sa rešpektujú", async () => {
    expect(await parseSpreadsheet({ name: "a.csv", content: text("a\tb\n1,5\t2\n") })).toEqual([["a", "b"], ["1,5", "2"]]);
    expect(await parseSpreadsheet({ name: "a.csv", content: text('meno,"suma; spolu"\nSYN,1\n') })).toEqual([["meno", "suma; spolu"], ["SYN", "1"]]);
  });

  it("nezmenený súbor sa uloží bajt po bajte rovnako", async () => {
    for (const data of [HODNOTY, FORMULA, "id;suma\r\nSYN-01;\"1;5\"\r\nSYN-02;2", "﻿id;suma\nSYN-01;0\nSYN-02\n"]) {
      expect(await roundTrip("x.csv", data)).toEqual(text(data));
    }
  });

  it("zmení sa len upravená bunka; oddeľovač, CRLF a desatinné čiarky ostanú", async () => {
    expect(await roundTrip("hodnoty.csv", HODNOTY, rows => { rows[1]![1] = "7,25"; }))
      .toEqual(text("id;suma\nSYN-01;7,25\nSYN-02;\nSYN-03;-125,50\n"));
    expect(await roundTrip("x.csv", "id;suma\r\nSYN-01;\"1;5\"\r\nSYN-02;2\r\n", rows => { rows[2]![1] = "a;b"; }))
      .toEqual(text("id;suma\r\nSYN-01;\"1;5\"\r\nSYN-02;\"a;b\"\r\n"));
  });

  it("doplnenie tvaru mriežky (kratší riadok) nepridá do súboru oddeľovače", async () => {
    const data = "id;suma;pozn\nSYN-01\nSYN-02;2;x\n";
    expect(await roundTrip("x.csv", data, rows => { rows[1] = ["SYN-01", "", ""]; rows[2]![1] = "3"; }))
      .toEqual(text("id;suma;pozn\nSYN-01\nSYN-02;3;x\n"));
  });

  it("nový riadok a stĺpec použijú pôvodný oddeľovač", async () => {
    expect(await roundTrip("hodnoty.csv", "id;suma\nSYN-01;1,5\n", rows => { rows.forEach(row => row.push("")); rows[0]![2] = "mena"; rows.push(["SYN-02", "2,5", "EUR"]); }))
      .toEqual(text("id;suma;mena\nSYN-01;1,5;\nSYN-02;2,5;EUR\n"));
  });
});

describe("ovládanie CSV editora (#493)", () => {
  it("tlačidlá sú v jazyku appky", () => {
    setLocale("sk");
    const client = new QueryClient();
    const content = text(HODNOTY);
    client.setQueryData(["artifact-spreadsheet", "hodnoty.csv", content], [["id", "suma"]]);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ArtifactSpreadsheetEditor name="hodnoty.csv" content={content} onSave={() => undefined} />
      </QueryClientProvider>,
    );
    client.clear();
    for (const english of [">Row<", ">Column<", ">Discard<", ">Save<", ">Saving<"]) expect(html).not.toContain(english);
    expect(html).toContain("Riadok");
    expect(html).toContain("Stĺpec");
    expect(html).toContain("Zahodiť");
    expect(html).toContain("Uložiť");
  });
});
