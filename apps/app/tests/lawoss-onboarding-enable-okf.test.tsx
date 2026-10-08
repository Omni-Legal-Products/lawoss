import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const withQuery = (node: React.ReactNode) => <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
import { ENABLE_OKF_ROUTE, offersOkf, OnboardingEntryActions } from "../src/lawoss/domains/onboarding/entry-actions";

test("Zapnúť OKF vedie na krok Priečinok", () => {
  expect(ENABLE_OKF_ROUTE).toBe("/welcome?continue=folder");
});

test("the link is offered until OKF is on, also when the status cannot be read", () => {
  expect(offersOkf({ profile: null })).toBe(true);
  expect(offersOkf({ profile: { okf: { enabled: false } } })).toBe(true);
  expect(offersOkf({ profile: {} })).toBe(true);
  expect(offersOkf(null)).toBe(true);
  expect(offersOkf({ profile: { okf: { enabled: true, acknowledgedAt: "2026-10-04T10:00:00.000Z", noticeVersion: "2026-10-04-alfa-1" } } })).toBe(false);
});

test("kompaktný panel nemá Zapnúť OKF, ale Pridať priečinok", () => {
  const html = renderToStaticMarkup(<MemoryRouter>{withQuery(<OnboardingEntryActions compact />)}</MemoryRouter>);
  expect(html).not.toContain("Turn on OKF");
  expect(html).toContain("Add folder");
});
