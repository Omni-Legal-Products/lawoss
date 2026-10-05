/**
 * LAWOSS: analytika je natrvalo vypnutá (MČ 5. 10. 2026). Nič sa neodošle ani so
 * starou uloženou voľbou „zapnuté“, ani s prepisom z Office panela, ani s kľúčom
 * v prostredí buildu, a prepínač sa nikde nezobrazí.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

process.env.VITE_LEGALWORK_POSTHOG_KEY = "phc_lawoss_test_key_must_never_be_used";
process.env.VITE_LEGALWORK_POSTHOG_HOST = "https://analytics.invalid";

const analytics = await import("../src/app/lib/analytics");
const { PreferencesView } = await import("../src/react-app/domains/settings/pages/preferences-view");
const { WelcomePage } = await import("../src/react-app/domains/onboarding/welcome-page");
const { isAnalyticsChoiceHidden } = await import("../src/lawoss/feature-flags");

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const requests: string[] = [];

function storageWith(prefs: Record<string, unknown>): Storage {
  const map = new Map<string, string>([["legalwork.preferences", JSON.stringify(prefs)]]);
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("LAWOSS: analytika natrvalo vypnutá", () => {
  beforeEach(() => {
    requests.length = 0;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: storageWith({ analyticsEnabled: true }),
        addEventListener: () => {},
      },
    });
    globalThis.fetch = (async (input: unknown) => {
      requests.push(String(input));
      return new Response("ok");
    }) as typeof fetch;
  });

  afterEach(() => {
    analytics.disposeAnalytics();
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    globalThis.fetch = originalFetch;
  });

  test("stará uložená voľba a prepis z panela nič neodošlú", async () => {
    expect(analytics.getStoredAnalyticsConsent()).toBe(true);
    analytics.setAnalyticsConsentOverride(true);
    analytics.initAnalytics();
    for (let index = 0; index < 120; index += 1) {
      analytics.captureAnalyticsEvent(`lawoss_event_${index}`, { surface: "desktop" });
    }
    await analytics.flushAnalytics();
    expect(analytics.isAnalyticsEnabled()).toBe(false);
    expect(analytics.isAnalyticsSending()).toBe(false);
    expect(requests).toEqual([]);
  });

  test("prepínač nie je v Nastaveniach ani na uvítacej obrazovke", () => {
    expect(isAnalyticsChoiceHidden()).toBe(true);
    const settings = renderToStaticMarkup(
      <PreferencesView
        busy={false}
        showThinking={false}
        onToggleShowThinking={() => {}}
        autoCompactContext={false}
        autoCompactContextBusy={false}
        onToggleAutoCompactContext={() => {}}
        analyticsEnabled={true}
        onToggleAnalytics={() => {}}
        hideAppMode="never"
        onChangeHideAppMode={() => {}}
      />,
    );
    expect(settings).not.toContain("settings.analytics_toggle");
    expect(settings).not.toMatch(/anonym/i);

    const welcome = renderToStaticMarkup(
      <WelcomePage
        onCreateProject={async () => {}}
        totalSteps={3}
        analyticsEnabled={true}
        onAnalyticsChange={() => {}}
      />,
    );
    expect(welcome).not.toMatch(/anonym/i);
    expect(welcome).not.toContain("welcome.analytics");
    expect(welcome).not.toContain('role="switch"');
  });
});
