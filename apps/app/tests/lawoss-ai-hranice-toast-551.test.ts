// LAWOSS #551: odmietnutie AI hranicami pri odoslaní z existujúceho chatu ukazovalo anglický text servera bez odkazu do nastavení.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { t } from "../src/i18n";
import { composerFailureToast } from "../src/lawoss/domains/ai/composer-failure-toast";

const denied = new Error('403 {"code":"ai_transfer_denied","message":"Protected AI processing is unavailable. Continue manually without a model."}');

test("odmietnutie AI hranicami: lokalizovaná veta, ostáva na obrazovke a ponúkne nastavenie", () => {
  const open = () => undefined;
  const toast = composerFailureToast(denied, t("composer.send_failed_restored"), open);
  expect(toast.title).toBe(t("composer.send_failed_restored"));
  expect(toast.options.description).toBe(t("lawoss.ai_boundaries.chat_refused"));
  expect(toast.options.description).not.toContain("Protected AI");
  expect(toast.options.duration).toBe(Infinity);
  expect(toast.options.action?.label).toBe(t("lawoss.ai_boundaries.open_settings"));
  expect(toast.options.action?.onClick).toBe(open);
});

test("iná chyba ostáva bežným toastom s textom chyby", () => {
  const toast = composerFailureToast(new Error("disk full"), t("composer.send_failed_restored"));
  expect(toast.options.description).toBe("disk full");
  expect(toast.options.duration).toBeUndefined();
  expect(toast.options.action).toBeUndefined();
});

test("odoslanie aj front v chate používajú to isté spracovanie chyby", () => {
  const source = readFileSync(new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url), "utf8");
  expect(source).not.toMatch(/toast\.error\(t\("composer\.send_failed_restored"\), \{ description: error instanceof Error/);
  expect(source).toContain('failureToast(error, t("composer.send_failed_restored"))');
  expect(source).toContain('failureToast(error, t("composer.queue_failed"))');
});
