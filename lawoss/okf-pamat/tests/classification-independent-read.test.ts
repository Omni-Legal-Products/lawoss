import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { newRecord, RECORD_TYPES, serializeRecord, statusSkeleton, syncStatus, writeIndex, writeLog } from "../src/index.ts";

function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "okf-classification-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = join(root, "Client");
  const matter = join(client, "Matters", "Case");
  const office = join(root, "Office");
  for (const dir of [matter, client, office]) mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(client, "client.md"), "---\ntype: client\n---\n");
  writeFileSync(join(matter, "_STATUS.md"), statusSkeleton("sk"));
  return { matter, client, office };
}

test("full read retains truth, history, deadlines and source metadata for every type across all scopes", (t) => {
  const { matter, client, office } = setup(t);
  const dirs = [matter, client, office];
  for (const [index, type] of RECORD_TYPES.entries()) {
    const record = newRecord({ id: `record-${index}-custom`, type, jurisdiction: "sk", title: `Title ${type}`,
      description: "Krátky popis úmyselne neobsahuje dôležitý fakt.", truth: `Dôležitý fakt uložený ako ${type}.`,
      created: "2026-09-20", updated: "2026-09-20", state: "done", deadlines: ["2026-10-01"],
      timeline: [{ date: "2026-09-20", text: `Starší kontext ${type}.` }], sources: [{ resource: `source-${type}.pdf` }],
    });
    writeFileSync(join(dirs[index % dirs.length]!, "memory", `renamed-${index}.md`), serializeRecord(record));
  }
  const result = runCli(["read", matter]);
  assert.equal(result.code, 0, result.out);
  for (const [index, type] of RECORD_TYPES.entries()) {
    assert.ok(result.out.includes(`Dôležitý fakt uložený ako ${type}.`), type);
    assert.ok(result.out.includes(`Starší kontext ${type}.`), type);
    assert.ok(result.out.includes(`source-${type}.pdf`), type);
    assert.match(result.out, new RegExp(`Revision record-${index}-custom: [a-f0-9]{64}`));
  }
  assert.equal((result.out.match(/2026-10-01/g) ?? []).length, RECORD_TYPES.length);
});

test("misclassified facts still have working canonical source links after files are renamed", (t) => {
  const { matter } = setup(t);
  const record = newRecord({ id: "Q-client-instruction", type: "question", jurisdiction: "sk", title: "Pokyn klienta",
    description: "Prečítaj celý pokyn.", truth: "Nesmie sa uzavrieť zmier bez kontaktovania klienta.",
    created: "2026-09-20", updated: "2026-09-20", deadlines: ["2026-10-01"],
    timeline: [{ date: "2026-09-20", text: "Klient spresnil pokyn." }],
  });
  writeFileSync(join(matter, "memory", "renamed-note.md"), serializeRecord(record));
  writeIndex(matter); writeLog(matter); syncStatus(matter);
  for (const name of ["index.md", "log.md"]) {
    assert.ok(readFileSync(join(matter, "memory", name), "utf8").includes("[Q-client-instruction](./renamed-note.md)"), name);
  }
  const status = readFileSync(join(matter, "_STATUS.md"), "utf8");
  assert.ok(status.includes("[Q-client-instruction](./memory/renamed-note.md)"));
  assert.ok(status.includes("2026-10-01"));
});

test("unreadable input ledger reports incomplete context while retaining every readable record", (t) => {
  const { matter } = setup(t);
  const record = newRecord({ id: "Q-001", type: "question", jurisdiction: "sk", title: "Pokyn", description: "p",
    truth: "Zachovať tento podstatný fakt.", created: "2026-09-20", updated: "2026-09-20", timeline: [] });
  writeFileSync(join(matter, "memory", "question.md"), serializeRecord(record));
  mkdirSync(join(matter, "VSTUPY.md"));
  const result = runCli(["read", matter]);
  assert.equal(result.code, 1);
  assert.match(result.out, /NEÚPLNÉ ČÍTANIE/);
  assert.match(result.out, /VSTUPY\.md/);
  assert.ok(result.out.includes(record.truth));
});

for (const [name, extra] of [
  ["unknown section", "\n## Pokyn klienta\nNesmie sa uzavrieť zmier.\n"],
  ["multiline history", "\n  Pokračovanie: klient odvolal súhlas.\n"],
]) {
  test(`${name} cannot silently vanish from a successful full read`, (t) => {
    const { matter } = setup(t);
    const record = newRecord({ id: "S-001", type: "subject", jurisdiction: "sk", title: "Klient", description: "p",
      truth: "Čitateľný obsah.", birth_number: "800101/1234", created: "2026-09-20", updated: "2026-09-20",
      timeline: [{ date: "2026-09-20", text: "Zaznamenaný pokyn." }] });
    const path = join(matter, "memory", "source.md");
    const source = serializeRecord(record) + extra;
    writeFileSync(path, source);
    const result = runCli(["read", matter]);
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /NEÚPLNÉ ČÍTANIE/);
    assert.ok(result.out.includes(path));
    assert.match(result.out, /Otvor celý zdrojový súbor/);
    assert.ok(result.out.includes(record.truth));
    assert.ok(!result.out.includes("800101/1234"), "the diagnostic must not dump unmasked frontmatter");
    assert.throws(() => syncStatus(matter), /NEÚPLNÉ ČÍTANIE/);
    assert.equal(readFileSync(path, "utf8"), source);
  });
}

test("full read includes matter and client communication channels, independently of record classification", (t) => {
  const { matter, client } = setup(t);
  writeFileSync(join(matter, "KOMUNIKACNE-KANALY.md"), "Pokyn veci: kontaktovať cez dátovú schránku.");
  writeFileSync(join(client, "KOMUNIKACNE-KANALY.md"), "Pokyn klienta: nepoužívať pracovný e-mail.");
  const result = runCli(["read", matter]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /Pokyn veci: kontaktovať/);
  assert.match(result.out, /Pokyn klienta: nepoužívať/);
  assert.ok(result.out.includes(join(matter, "KOMUNIKACNE-KANALY.md")));
  assert.ok(result.out.includes(join(client, "KOMUNIKACNE-KANALY.md")));
});

test("unreadable client communication channels mark context incomplete without discarding matter channels", (t) => {
  const { matter, client } = setup(t);
  writeFileSync(join(matter, "KOMUNIKACNE-KANALY.md"), "Vecný pokyn dostupný.");
  mkdirSync(join(client, "KOMUNIKACNE-KANALY.md"));
  const result = runCli(["read", matter]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /NEÚPLNÉ ČÍTANIE/);
  assert.ok(result.out.includes(join(client, "KOMUNIKACNE-KANALY.md")));
  assert.match(result.out, /Vecný pokyn dostupný/);
});
