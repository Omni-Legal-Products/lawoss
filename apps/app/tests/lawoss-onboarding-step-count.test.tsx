import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionOnboardingStep, visibleSessionOnboardingStages } from "../src/lawoss/domains/onboarding/session-steps";
import { StepDots } from "../src/react-app/domains/onboarding/onboarding-cover";

// 🟡 LAWOSS (MČ 8. 11. 2026): the step counter matches the steps LAWOSS really shows.
test("with the recorder and AI plans hidden, desktop shows office and permissions, web shows none", () => {
  expect(visibleSessionOnboardingStages(true)).toEqual(["office", "permissions"]);
  expect(visibleSessionOnboardingStages(false)).toEqual([]);
  expect(sessionOnboardingStep("office", true)).toEqual({ step: 1, total: 2 });
  expect(sessionOnboardingStep("permissions", true)).toEqual({ step: 2, total: 2 });
});

test("the rendered dots follow the visible count, not upstream's fixed six", () => {
  const { step, total } = sessionOnboardingStep("permissions", true);
  const html = renderToStaticMarkup(<StepDots step={step} total={total} />);
  const upstream = renderToStaticMarkup(<StepDots step={6} total={6} />);
  expect(html).toContain('aria-valuemax="2"');
  expect(html).toContain('aria-valuenow="2"');
  expect(upstream).toContain('aria-valuemax="6"');
});
