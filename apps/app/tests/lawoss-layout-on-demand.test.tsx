/**
 * LAWOSS: rozloženie strany len na požiadanie (MČ 8. 11. 2026, limit RAM 2 GB, #367).
 * Pri rozpoznaných stranách je jedno tlačidlo s krátkym upozornením; počas behu kontroly je vypnuté.
 */
import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SavedReview } from "@legalwork/types/reviews";
import { currentLanguagePreference, setLanguagePreference, setLocale } from "../src/i18n";
import { LayoutOnDemandAction } from "../src/lawoss/domains/reviews/layout-on-demand";
import { reviewKey } from "../src/react-app/domains/reviews/review-ui";

const preference = currentLanguagePreference();
afterEach(() => setLanguagePreference(preference));

function render(status: SavedReview["status"]) {
  const queryClient = new QueryClient();
  const review = { id: "review-1", revision: 3, status, runner: null } as unknown as SavedReview; // Only fields the action reads.
  queryClient.setQueryData(reviewKey("ws", "review-1"), review);
  const client = { getReview: async () => review, startReview: async () => review };
  return renderToStaticMarkup(<QueryClientProvider client={queryClient}>
    <LayoutOnDemandAction client={client} workspaceId="ws" reviewId="review-1" documentId="doc-1" onPrepared={() => {}} />
  </QueryClientProvider>);
}

test("offers page layout with a memory hint in Slovak, and waits while the review runs", () => {
  setLocale("sk");
  const idle = render("complete");
  expect(idle).toContain("Spracovať aj rozloženie strany");
  expect(idle).toContain("Potrebuje viac pamäte a trvá dlhšie");
  expect(idle).not.toContain(" disabled=\"\"");
  const running = render("running");
  expect(running).toContain(" disabled=\"\"");
  expect(running).toContain("Dostupné po dokončení kontroly.");
});

test("the action is translated for Czech, English and German", () => {
  for (const [locale, label] of [["cs", "Zpracovat i rozvržení stránky"], ["en", "Also process page layout"], ["de", "Auch Seitenaufbau verarbeiten"]] as const) {
    setLocale(locale);
    expect(render("needs_review")).toContain(label);
  }
});
