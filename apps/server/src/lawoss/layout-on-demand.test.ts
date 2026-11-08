import { afterEach, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import type { WorkspaceInfo } from "../types.js";
import { DocumentPreparation } from "../document-preparation/service.js";
import { OcrManager } from "../ocr/manager.js";
import { ReviewService, reviewRunActive } from "../reviews/service.js";
import { ReviewDefaults } from "../reviews/storage.js";
import { columnBackend } from "../reviews/policy.js";
import type { ReviewCapabilities, ReviewColumn, SavedReview } from "../reviews/schema.js";
import { pagePrepared, textOnlyReviewReasons } from "./layout-on-demand.js";

const roots: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

test("a page read without layout is finished for automatic runs but not for a layout request", () => {
  const ocr = { text: "Synthetic clause", regions: [], truncated: false };
  expect(pagePrepared({ status: "complete", ocr }, false)).toBe(true);
  expect(pagePrepared({ status: "complete", ocr }, true)).toBe(false);
  expect(pagePrepared({ status: "complete", ocr, structure: { status: "complete" } }, true)).toBe(true);
  // A page with its own PDF text needs neither OCR nor layout.
  expect(pagePrepared({ status: "complete", ocr: null }, true)).toBe(true);
  expect(pagePrepared({ status: "needs-review", ocr, structure: { status: "unavailable" } }, false)).toBe(false);
  expect(pagePrepared({ status: "error", ocr: null }, false)).toBe(false);
});

test("missing layout alone does not flag a text-only page", () => {
  expect(textOnlyReviewReasons({ nativeText: "", ocr: { text: "Synthetic clause", regions: [], truncated: false } })).toEqual([]);
  expect(textOnlyReviewReasons({ nativeText: "", ocr: { text: "", regions: [], truncated: false } })).toEqual(["no-text"]);
});

test("a review asks for layout only when the lawyer requests it for one document, and reruns its cells", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-layout-review-")); roots.push(root);
  const workspace: WorkspaceInfo = { id: "test", name: "Test", path: root, preset: "starter", workspaceType: "local" };
  const pdf = await PDFDocument.create();
  const clause = "Synthetic test clause: the supplier delivers the goods within thirty days of the order and bears the risk.";
  pdf.addPage([600, 400]).drawText(`${clause}\n${clause}`, { x: 20, y: 350, size: 9 });
  await writeFile(join(root, "scan.pdf"), await pdf.save());
  const column: ReviewColumn = { key: "delivery", label: "Delivery", question: "When are goods delivered?", kind: "text", options: [], hint: "" };
  const caps: ReviewCapabilities = { settings: { mode: "llm", jev: { providerId: "firm", model: "chat" }, llm: { providerId: "firm", model: "chat" } }, allowedKinds: ["text"], errors: [],
    models: [{ backend: "llm", providerId: "firm", model: "chat", name: "Chat", providerName: "Firm" }] };
  let executed = 0;
  const preparation = new DocumentPreparation(new OcrManager(join(root, "ocr")));
  const requests: unknown[] = [];
  const start = preparation.start.bind(preparation);
  spyOn(preparation, "start").mockImplementation(async (path, raw) => { requests.push(raw); return start(path, raw); });
  const service = new ReviewService({ models: async () => structuredClone(caps), execute: async (_workspace, review: SavedReview, question, evidence) => {
    executed++;
    return { value: "30 days", reason: "", citations: [], confidence: null, evidence: "uncited", backend: columnBackend(review.settings.mode, question), providerId: "firm", model: "chat", requestedModel: "chat", sourceHash: evidence.hash, prompt: question, completedAt: Date.now(), chunks: [] };
  } }, preparation, new ReviewDefaults(join(root, "app-state")));
  cleanups.push(() => service.stop());
  const settled = async (id: string) => {
    for (let i = 0; i < 300; i++) { const value = await service.get(workspace, id); if (value.status !== "running" && !reviewRunActive(workspace.path, id)) return value; await Bun.sleep(10); }
    throw new Error("Review did not settle");
  };
  let review = await service.create(workspace, { requestId: randomUUID(), name: "Layout", files: ["scan.pdf"], columns: [column] });
  await service.start(workspace, review.id, { revision: review.revision });
  review = await settled(review.id);
  expect(requests).toEqual([expect.objectContaining({ layout: false })]);
  // A plain run of a finished review prepares nothing again.
  await service.start(workspace, review.id, { revision: review.revision });
  review = await settled(review.id);
  expect(requests).toHaveLength(1); expect(executed).toBe(1);
  await service.start(workspace, review.id, { revision: review.revision, documentIds: [review.documents[0]!.id], layout: true });
  review = await settled(review.id);
  expect(requests).toHaveLength(2); expect(requests[1]).toMatchObject({ layout: true, force: false });
  expect(executed).toBe(2); expect(review.cells[0]!.status).toBe("complete");
  await expect(service.start(workspace, review.id, { revision: review.revision, retryFailed: true, layout: true })).rejects.toThrow("Retry failed");
}, 20_000);
