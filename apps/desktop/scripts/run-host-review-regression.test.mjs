import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runHostReviewSmoke } from "./run-host-review-regression.mjs";

test("profile outlives the actual child final Session Storage writer and is removed after exit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-review-runner-test-"));
  const script = path.join(root, "owned-child.mjs"), observed = path.join(root, "observed.json");
  await writeFile(script, `import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';
const profile=process.env.LEGALWORK_HOST_REVIEW_USERDATA;
await mkdir(path.join(profile,'Session Storage'));
await new Promise(resolve=>setTimeout(resolve,100));
await writeFile(path.join(profile,'Session Storage','late-write'),'closed last');
await writeFile(${JSON.stringify(observed)},JSON.stringify({profile,finalWrite:true}));`);
  try {
    await runHostReviewSmoke({binary: process.execPath, script, timeoutMs: 5000});
    const result = JSON.parse(await readFile(observed, "utf8"));
    assert.equal(result.finalWrite, true);
    await assert.rejects(access(result.profile), {code: "ENOENT"});
  } finally {await rm(root, {recursive: true, force: true});}
});

test("child failure is surfaced after owned cleanup, without an unhandled rejection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-review-runner-test-"));
  const script = path.join(root, "failed-child.mjs"), observed = path.join(root, "profile.txt");
  await writeFile(script, `import {writeFile} from 'node:fs/promises';await writeFile(${JSON.stringify(observed)},process.env.LEGALWORK_HOST_REVIEW_USERDATA);process.exitCode=7;`);
  try {
    await assert.rejects(runHostReviewSmoke({binary: process.execPath, script, timeoutMs: 5000}), /exited.*7/);
    await assert.rejects(access(await readFile(observed, "utf8")), {code: "ENOENT"});
  } finally {await rm(root, {recursive: true, force: true});}
});

test("a stuck owned child is terminated before cleanup and reported as timeout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-review-runner-test-"));
  const script = path.join(root, "stuck-child.mjs"), observed = path.join(root, "profile.txt");
  await writeFile(script, `import {writeFile} from 'node:fs/promises';await writeFile(${JSON.stringify(observed)},process.env.LEGALWORK_HOST_REVIEW_USERDATA);setInterval(()=>{},1000);`);
  try {
    await assert.rejects(runHostReviewSmoke({binary: process.execPath, script, timeoutMs: 1000}), /timed out/);
    await assert.rejects(access(await readFile(observed, "utf8")), {code: "ENOENT"});
  } finally {await rm(root, {recursive: true, force: true});}
});
