import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ENABLE_OKF_ROUTE, offersOkf, OnboardingEntryActions } from "../src/lawoss/domains/onboarding/entry-actions";

test("Zapnúť OKF reopens onboarding at the OKF step", () => {
  expect(ENABLE_OKF_ROUTE).toBe("/welcome?continue=okf");
});

test("the link is offered until OKF is on, also when the status cannot be read", () => {
  expect(offersOkf({ profile: null })).toBe(true);
  expect(offersOkf({ profile: { okf: { enabled: false } } })).toBe(true);
  expect(offersOkf({ profile: {} })).toBe(true);
  expect(offersOkf(null)).toBe(true);
  expect(offersOkf({ profile: { okf: { enabled: true, acknowledgedAt: "2026-10-04T10:00:00.000Z", noticeVersion: "2026-10-04-alfa-1" } } })).toBe(false);
});

test("the entry actions render the OKF link once the choice is known", () => {
  const html = renderToStaticMarkup(<MemoryRouter><OnboardingEntryActions okfOffered /></MemoryRouter>);
  expect(html).toContain("Turn on OKF");
  expect(renderToStaticMarkup(<MemoryRouter><OnboardingEntryActions okfOffered={false} /></MemoryRouter>)).not.toContain("Turn on OKF");
});
