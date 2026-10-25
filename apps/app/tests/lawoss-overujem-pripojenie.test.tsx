import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { setLocale } from "../src/i18n";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { AiStepView, boundedCheck, CHECK_LIMIT_MS, type AiModelView } from "../src/lawoss/domains/onboarding/ai-step";
import { AssistantStepView } from "../src/lawoss/domains/onboarding/wizard/assistant-step";
import { readyRows } from "../src/lawoss/domains/onboarding/wizard/ready-model";
import { wizardText } from "../src/lawoss/domains/onboarding/wizard/wizard-text";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { isConnectionProblem } from "../src/lawoss/lite/connection-problem";
import { liteStateText } from "../src/lawoss/lite/state-text";

// N-A5-8 (UI test dev 25. 10. 2026): keď poskytovateľ neodpovedal (sieť, certifikát), krok 4 ukazoval „Overujem
// pripojenie…“ viac ako 10 minút a po reštarte Dnes len červené „Vaše prípady sa nepodarilo načítať“.

afterEach(() => { setLocale("en"); });

const noop = () => {};
const sk = wizardText("sk");

describe("krok 4: overovanie má časový limit a obyčajnú hlášku", () => {
  const ready: AiModelView = { state: "ready", modelLabel: "GPT-6 Luna" };
  test("overuje sa najviac CHECK_LIMIT_MS, potom alebo pri chybe „nepodarilo sa overiť“ s opakovaním", () => {
    expect(CHECK_LIMIT_MS).toBeLessThanOrEqual(30_000);
    expect(boundedCheck(ready, true, false, false, noop)).toEqual({ state: "checking" });
    expect(boundedCheck(ready, true, false, true, noop)).toMatchObject({ state: "unreachable" });
    expect(boundedCheck(ready, false, true, false, noop)).toMatchObject({ state: "unreachable" });
    expect(boundedCheck(ready, false, false, true, noop)).toBe(ready);
    expect(boundedCheck(ready, true, false, true, noop).retry).toBe(noop);
  });

  test("krok 4 povie, čo skúsiť, ponúkne Skúsiť znova a pokračovanie bez AI; súhrn v kroku 6 nie je „Overujem“", () => {
    const model: AiModelView = { state: "unreachable", retry: noop };
    const html = renderToStaticMarkup(<AssistantStepView text={sk} locale="sk" model={model} boundariesOn={false} busy={false} onOpenAiSettings={noop} onContinue={noop} />);
    expect(html).toContain("Pripojenie sa nepodarilo overiť. Skontrolujte internet (firemná sieť, VPN alebo proxy) a skúste znova.");
    expect(html).toContain("data-lawoss-ai-retry");
    expect(html).toContain("Skúsiť znova");
    expect(html).not.toContain("Overujem");
    const row = readyRows(sk, { model, agent: "ask" }).find((item) => item.id === "ai");
    expect(row).toMatchObject({ tone: "warn", fix: "ai" });
    // Starší krok AI (cesta bez OKF) tiež.
    const old = renderToStaticMarkup(<AiStepView locale="sk" model={model} busy={false} onOpenAiSettings={noop} onContinue={noop} />);
    expect(old).toContain("Pripojenie k AI sa nepodarilo overiť");
    expect(old).toContain("Skúsiť znova");
  });
});

describe("Dnes: pri probléme so spojením obyčajná veta, čo skúsiť", () => {
  test("chyby spojenia sa rozpoznajú z typu, kódu a stavu; iné chyby nie", () => {
    const abort = new Error("This operation was aborted"); abort.name = "AbortError";
    expect(isConnectionProblem(abort)).toBe(true);
    expect(isConnectionProblem(new LegalworkServerError(500, "internal", "Unexpected server error"))).toBe(true);
    expect(isConnectionProblem(new Error("…/activate failed after 10006ms: Vypršal časový limit požiadavky."))).toBe(true);
    expect(isConnectionProblem(Object.assign(new Error("x"), { cause: { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" } }))).toBe(true);
    expect(isConnectionProblem(new LegalworkServerError(404, "project_folder_unavailable", "Reconnect the project drive"))).toBe(false);
    expect(isConnectionProblem(new Error("Neplatný frontmatter"))).toBe(false);
    expect(isConnectionProblem(null)).toBe(false);
  });

  test("Dnes pod červenou chybou ukáže, čo skúsiť; pri inej chybe nie", () => {
    setLocale("sk");
    const render = (error: unknown) => renderToStaticMarkup(<MemoryRouter>
      <OkfPageState connection="ready" workspace="Prax" data={undefined} error={error} loading={false} stateText={liteStateText("sk")}>{() => null}</OkfPageState>
    </MemoryRouter>);
    const timeout = render(new LegalworkServerError(500, "internal", "GET /opencode/provider failed"));
    expect(timeout).toContain("Vaše prípady sa nepodarilo načítať");
    expect(timeout).toContain("data-lawoss-connection-hint");
    // Jazyk nápovedy je jazyk rozhrania (`useLocale`, v SSR teste angličtina); SK/CS/DE overuje test:i18n.
    expect(timeout).toContain("Check the connection (company network, VPN or proxy)");
    expect(render(new Error("Neplatný frontmatter"))).not.toContain("data-lawoss-connection-hint");
  });
});
