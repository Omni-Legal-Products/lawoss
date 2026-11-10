import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { setLocale } from "../src/i18n";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { isConnectionProblem, isHostAccessDenied, retryUnlessHostAccessDenied } from "../src/lawoss/lite/connection-problem";
import { liteStateText } from "../src/lawoss/lite/state-text";
import { OKF_REFRESH_MS, practiceRootRefetchInterval } from "../src/lawoss/okf/read-model";

// #338: prehľad praxe je len pre hostiteľa. Bez jeho tokenu Dnes ukazoval červené
// „Vaše prípady sa nepodarilo načítať — Invalid host token“ a dotazy sa opakovali.

afterEach(() => { setLocale("en"); });

const denied = () => new LegalworkServerError(401, "unauthorized", "Invalid host token");

describe("#338: pripojenie bez prístupu hostiteľa", () => {
  test("odmietnutie hostiteľa sa rozpozná z kódu a stavu, nie z textu; nie je to problém spojenia", () => {
    expect(isHostAccessDenied(denied())).toBe(true);
    expect(isConnectionProblem(denied())).toBe(false);
    expect(isHostAccessDenied("Invalid host token")).toBe(false);
    expect(isHostAccessDenied(new Error("Invalid host token"))).toBe(false);
    expect(isHostAccessDenied(new LegalworkServerError(403, "forbidden", "Forbidden"))).toBe(false);
    expect(isHostAccessDenied(new LegalworkServerError(503, "unavailable", "Service unavailable"))).toBe(false);
    expect(isHostAccessDenied(null)).toBe(false);
  });

  test("Dnes povie, že toto pripojenie nemá prístup k prehľadu praxe, bez technického textu a bez rady o sieti", () => {
    setLocale("sk");
    const html = renderToStaticMarkup(<MemoryRouter>
      <OkfPageState connection="ready" workspace="Prax" data={undefined} error="Invalid host token" hostAccessDenied loading={false} stateText={liteStateText("sk")} retry={<button type="button">retry</button>}>{() => "dashboard"}</OkfPageState>
    </MemoryRouter>);
    expect(html).toContain("data-lawoss-host-access");
    // Jazyk vety je jazyk rozhrania (`useLocale`, v SSR teste angličtina); SK/CS/DE overuje test:i18n.
    expect(html).toContain("This connection has no access to the practice overview");
    expect(html).not.toContain("Invalid host token");
    expect(html).not.toContain("data-lawoss-connection-hint");
    expect(html).not.toContain("dashboard");
    // Skúsiť znova ostáva: po pripojení s prístupom sa dá prečítať hneď.
    expect(html).toContain("retry");
  });

  test("odmietnutie hostiteľa aj z čítania prehľadu (objekt chyby) dá rovnaký stav", () => {
    const html = renderToStaticMarkup(<MemoryRouter>
      <OkfPageState connection="ready" workspace="Prax" data={undefined} error={denied()} loading={false} stateText={liteStateText("sk")}>{() => null}</OkfPageState>
    </MemoryRouter>);
    expect(html).toContain("data-lawoss-host-access");
    expect(html).not.toContain("Invalid host token");
  });

  test("iná chyba ostáva chybou s technickými podrobnosťami", () => {
    const html = renderToStaticMarkup(<MemoryRouter>
      <OkfPageState connection="ready" workspace="Prax" data={undefined} error={new Error("Neplatný frontmatter")} loading={false} stateText={liteStateText("sk")}>{() => null}</OkfPageState>
    </MemoryRouter>);
    expect(html).not.toContain("data-lawoss-host-access");
    expect(html).toContain("Neplatný frontmatter");
  });

  test("koreň praxe sa po odmietnutí hostiteľa nedotazuje dookola; inak každých OKF_REFRESH_MS", () => {
    expect(practiceRootRefetchInterval(denied())).toBe(false);
    expect(practiceRootRefetchInterval(null)).toBe(OKF_REFRESH_MS);
    expect(practiceRootRefetchInterval(new LegalworkServerError(503, "unavailable", "Service unavailable"))).toBe(OKF_REFRESH_MS);
  });

  test("opakované pokusy (voľba OKF, skilly klienta) po odmietnutí hostiteľa skončia hneď", () => {
    expect(retryUnlessHostAccessDenied(denied(), 8)).toBe(false);
    expect(retryUnlessHostAccessDenied(new Error("server address not ready"), 8)).toBe(true);
    expect(retryUnlessHostAccessDenied(new Error("server address not ready"), 1)).toBe(false);
  });
});
