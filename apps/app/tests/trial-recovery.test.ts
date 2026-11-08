import { expect, test } from "bun:test";
import { usageLimitFixture } from "../src/react-app/design-system/usage-limit-fixture";
import { parseTrialSubscriptionResult, trialAllowanceExhausted } from "../src/react-app/domains/connections/usage-control/trial-recovery-state";

test("trial recovery is offered only for an exhausted trial on Eigenwelt models", () => {
  const { usage } = usageLimitFixture("plus", true, "eigenwelt");
  expect(trialAllowanceExhausted(usage, "eigenwelt")).toBe(false);
  usage.trial = { endsAt: "2026-10-23T12:00:00Z" };
  expect(trialAllowanceExhausted(usage, "eigenwelt")).toBe(true);
  expect(trialAllowanceExhausted(usage, "openai")).toBe(false);
  expect(trialAllowanceExhausted({ ...usage, enabled: false }, "eigenwelt")).toBe(false);
  expect(trialAllowanceExhausted({ ...usage, me: { ...usage.me, remainingCents: 100, blockedReason: null } }, "eigenwelt")).toBe(false);
  expect(trialAllowanceExhausted({ ...usage, me: { ...usage.me, blockedReason: "service_limit" } }, "eigenwelt")).toBe(false);
  expect(trialAllowanceExhausted({ ...usage, me: { ...usage.me, extraRemainingCents: 2000, blockedReason: null } }, "eigenwelt")).toBe(false);
});
test("payment responses preserve full annual amounts and require explicit verified status", () => {
  expect(parseTrialSubscriptionResult({ quoteId: "q", recurringAmountCents: 34800, seatCount: 1, amountCents: 41412, billingInterval: "year" })).toEqual({ quoteId: "q", recurringAmountCents: 34800, seatCount: 1, amountCents: 41412, billingInterval: "year" });
  expect(parseTrialSubscriptionResult({ quoteId: "q", status: "requires_payment", url: "https://invoice.stripe.com/i/test" })).toEqual({ quoteId: "q", status: "requires_payment", url: "https://invoice.stripe.com/i/test" });
  for (const value of [null, { quoteId: "q", amountCents: -1, billingInterval: "month" }, { quoteId: "q", amountCents: 1.5, billingInterval: "year" }, { quoteId: "q", status: "active" }])
    expect(() => parseTrialSubscriptionResult(value)).toThrow("response");
});
