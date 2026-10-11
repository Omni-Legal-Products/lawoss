import { expect, test } from "bun:test";
import { eigenweltUsageLimitFromError, parseProviderUsageLimit, providerUsageLimitErrorText } from "../src/app/lib/provider-usage-limit";
import { describeOpencodeSessionError } from "../src/react-app/domains/session/sync/usechat-adapter";
import { usageLimitFixture } from "../src/react-app/design-system/usage-limit-fixture";
import { checkConfirmedTopUp, requestUsageBlockReason, usageIsAvailable } from "../src/react-app/domains/connections/usage-control/usage-recovery";
import { usageBlockNeedsSettings, usageRequestMessageKey } from "../src/react-app/domains/connections/usage-control/usage-block";
import type { UsageLimitDetails } from "@legalwork/types/provider-usage-limit";
import en from "../src/i18n/locales/en";
import de from "../src/i18n/locales/de";

const limit: UsageLimitDetails = {reason:"organization_limit",requiredMicros:200000,availableMicros:90000};
const message = "Budget has been exceeded. Eigenwelt usage limit: " + JSON.stringify({...limit,orgId:"private"});
test("gateway details survive wrapped HTTP errors, terminal errors and saved transcript markers", () => {
  const error = {name:"APIError",data:{statusCode:429,message:"HTTP 429",responseBody:JSON.stringify({error:{message}})}};
  expect(eigenweltUsageLimitFromError(error)).toEqual(limit);
  expect(eigenweltUsageLimitFromError(message)).toEqual(limit);
  expect(parseProviderUsageLimit(describeOpencodeSessionError(error, "Failed", "eigenwelt"))).toEqual({providerId:"eigenwelt",limit});
  expect(parseProviderUsageLimit(providerUsageLimitErrorText("eigenwelt",limit))).toEqual({providerId:"eigenwelt",limit});
  expect(parseProviderUsageLimit(providerUsageLimitErrorText("openai"))).toEqual({providerId:"openai",limit:null});
  expect(parseProviderUsageLimit(providerUsageLimitErrorText("openai",limit))?.limit).toBeNull();
});
test("malformed or non-admission payloads cannot become a recovery action", () => {
  for (const data of [{...limit,reason:"unknown"},{...limit,requiredMicros:0},{...limit,availableMicros:-1},{...limit,availableMicros:200000},{...limit,requiredMicros:1.5}]) {
    expect(eigenweltUsageLimitFromError("Eigenwelt usage limit: " + JSON.stringify(data))).toBeNull();
  }
  expect(eigenweltUsageLimitFromError("Rate limit exceeded")).toBeNull();
});
test("positive wallet and personal allowance cannot bypass the organization's nine-cent remainder", async () => {
  const {usage} = usageLimitFixture("pro",true,"eigenwelt");
  const view = {...usage,walletCents:1009,orgExtraLimitCents:1000,orgExtraUsedCents:991,
    me:{...usage.me,extraUsedCents:991,extraRemainingCents:9,availableMicros:90000,requestLimitReason:limit.reason,blockedReason:null}};
  expect(usageIsAvailable(view)).toBe(true);
  expect(usageIsAvailable(view,limit)).toBe(false);
  expect(requestUsageBlockReason(view,limit)).toBe("organization_limit");
  expect(usageBlockNeedsSettings(requestUsageBlockReason(view,limit))).toBe(true);
  const topUp = await checkConfirmedTopUp("paid",async()=>({card:null,pendingTopUps:[]}),async()=>({...view,walletCents:5000}),limit);
  expect(topUp.status).toBe("blocked");
  expect(usageIsAvailable({...view,orgExtraLimitCents:2000,me:{...view.me,extraRemainingCents:1009,availableMicros:10090000}},limit)).toBe(true);
  // A fresh read can expose a different boundary after one limit is increased.
  expect(requestUsageBlockReason({...view,me:{...view.me,requestLimitReason:"wallet_empty"}},limit)).toBe("wallet_empty");
});
test("admission recovery preserves sub-cent precision and legacy platform compatibility", () => {
  const {usage} = usageLimitFixture("pro",true,"eigenwelt");
  const view = {...usage,me:{...usage.me,extraRemainingCents:0,availableMicros:9999,blockedReason:null}};
  expect(usageIsAvailable(view,{...limit,requiredMicros:9999,availableMicros:1})).toBe(true);
  expect(usageIsAvailable(view,{...limit,requiredMicros:10000,availableMicros:1})).toBe(false);
  expect(usageIsAvailable({...view,me:{...view.me,availableMicros:undefined,extraRemainingCents:9}},limit)).toBe(false);
  const serviceLimit: UsageLimitDetails = {...limit, reason:"service_limit", requiredMicros:1, availableMicros:0};
  expect(usageIsAvailable(view,serviceLimit)).toBe(false);
  expect(requestUsageBlockReason(view,serviceLimit)).toBe("service_limit");
});
test("request-specific messages are translated and do not label positive balances empty", () => {
  for (const reason of ["member_limit","organization_limit","wallet_empty","extra_disabled","seat_required","service_limit"]) {
    for (const admin of [true,false]) {
      const key=usageRequestMessageKey(reason,admin);
      expect(en[key]).toBeTruthy();expect(de[key]).toBeTruthy();
    }
  }
  expect(en[usageRequestMessageKey("organization_limit",true)]).not.toContain("empty");
  expect(en[usageRequestMessageKey("wallet_empty",true)]).not.toContain("empty");
});
