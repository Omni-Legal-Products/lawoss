import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  QueuedMessagesPanel,
  type QueuedMessagesPanelProps,
} from "../src/react-app/domains/session/modals/queued-messages-panel";
import type { QueuedComposerDraft } from "../src/react-app/domains/session/surface/composer-state-store";
import { t } from "../src/i18n";

const message: QueuedComposerDraft = {
  id: "follow-up",
  mode: "prompt",
  text: "Review the result",
  parts: [{ type: "text", text: "Review the result" }],
  attachments: [],
  editor: { draft: "Review the result", attachments: [], mentions: {}, pasteParts: [] },
};

function renderQueue(overrides: Partial<QueuedMessagesPanelProps> = {}) {
  return renderToStaticMarkup(<QueuedMessagesPanel
    messages={[]}
    paused={false}
    disabled={false}
    onRemove={() => {}}
    onEdit={() => {}}
    onReorder={() => {}}
    onCancelEdit={() => {}}
    onResume={() => {}}
    {...overrides}
  />);
}

test("an empty queue stays hidden after Stop pauses it", () => {
  expect(renderQueue()).toBe("");
  expect(renderQueue({ paused: true })).toBe("");
});

test("paused follow-ups still show the message and Resume control", () => {
  const html = renderQueue({ messages: [message], paused: true });
  expect(html).toContain(message.text);
  expect(html).toContain(t("composer.queue_paused"));
  expect(html).toContain(t("composer.resume_queue"));
  expect(renderQueue({ messages: [message] })).not.toContain(t("composer.queue_paused"));
});

test("a missing edited entry still offers Cancel edit without an empty pause banner", () => {
  const html = renderQueue({ editingId: message.id, paused: true });
  expect(html).toContain(t("composer.cancel_queued_edit"));
  expect(html).not.toContain(t("composer.queue_paused"));
  expect(html).not.toContain(t("composer.resume_queue"));
});

test("a delivery refused by AI hranice shows the localized sentence and a link to the setting", () => {
  let opened = 0;
  const refused = { ...message, status: "failed" as const, error: "Protected AI processing is unavailable. Continue manually without a model." };
  const html = renderQueue({ messages: [refused], paused: true, onOpenAiSettings: () => { opened++; } });
  expect(html).toContain(t("lawoss.ai_boundaries.chat_refused"));
  expect(html).toContain(t("lawoss.ai_boundaries.open_settings"));
  expect(html).not.toContain("Protected AI processing");
  expect(opened).toBe(0);
  const other = renderQueue({ messages: [{ ...message, status: "failed" as const, error: "Shell interpolation in shortcuts is disabled." }], paused: true, onOpenAiSettings: () => {} });
  expect(other).toContain("Shell interpolation in shortcuts is disabled.");
  expect(other).not.toContain(t("lawoss.ai_boundaries.open_settings"));
});

test("a queue paused after an app restart says why; Stop keeps the plain pause label (N-A7-17)", () => {
  const interrupted = renderQueue({ messages: [message], paused: true, restartPause: "interrupted" });
  expect(interrupted).toContain(t("lawoss.queue.paused_after_restart"));
  expect(interrupted).toContain(t("composer.resume_queue"));
  expect(interrupted).not.toContain(t("composer.queue_paused"));
  expect(t("lawoss.queue.paused_after_restart", "sk")).toBe("Front je pozastavený po reštarte aplikácie. Prvá úloha bola prerušená, skontrolujte jej výsledok a front potom obnovte.");
  // Nothing was running when the app quit: no claim about an interrupted task.
  const waiting = renderQueue({ messages: [message], paused: true, restartPause: "waiting" });
  expect(waiting).toContain(t("lawoss.queue.paused_after_restart_waiting"));
  expect(waiting).not.toContain(t("lawoss.queue.paused_after_restart"));
  expect(t("lawoss.queue.paused_after_restart_waiting", "sk")).not.toContain("prerušená");
  const stopped = renderQueue({ messages: [message], paused: true });
  expect(stopped).toContain(t("composer.queue_paused"));
  expect(stopped).not.toContain(t("lawoss.queue.paused_after_restart_waiting"));
});
