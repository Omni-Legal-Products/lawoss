import { test } from "node:test";
import assert from "node:assert/strict";
import { loadNativeCorpus } from "./corpus.mjs";
import { sha256 } from "../corpus.mjs";

test("native selection preserves the original 10-case / 30-reference / 31-PDF duplicate-copy shape", async () => {
  const corpus = await loadNativeCorpus(undefined);
  assert.equal(corpus.cases.length, 10);
  assert.equal(corpus.cases.flatMap(c => c.documents).length, 31);
  assert.equal(corpus.cases.flatMap(c => c.reference.documents).length, 30);
  for (const entry of corpus.cases) {
    const known = new Set(entry.reference.documents.map(r => r.sha256));
    assert.equal(known.size, 3);
    assert.ok(entry.documents.every(d => known.has(sha256(d.bytes))));
    assert.ok(entry.documents.some(d => /[\sěá]/.test(d.name)));
  }
  const first = corpus.cases[0];
  assert.equal(sha256(first.documents[0].bytes), sha256(first.documents[3].bytes));
  assert.notEqual(first.documents[0].name, first.documents[3].name);
});
