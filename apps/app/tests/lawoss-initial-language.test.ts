import { expect, test } from "bun:test";
import { buildSetupLedger, setupStatusLabel, type SetupLedgerInput } from "../src/lawoss/domains/onboarding/setup-ledger";
import { DEFAULT_ONBOARDING_PROGRESS } from "../src/lawoss/domains/onboarding/onboarding-state";

test("setup translates presentation while keeping status identifiers and input data intact", () => {
  const input: SetupLedgerInput = {
    workspace: { nazov: "Klientský názov", cesta: "/matter/CZ" },
    model: { poskytovatel: "Local provider", model: "model-id" },
    ochranaUprav: "allow", prvaUlohaHotova: false, postup: DEFAULT_ONBOARDING_PROGRESS,
  };
  const snapshot = JSON.stringify(input);
  const baseline = buildSetupLedger(input).map(({ id, poradie, stav }) => ({ id, poradie, stav }));
  for (const locale of ["cs", "sk", "en"] as const) {
    const rows = buildSetupLedger(input, locale);
    expect(rows.map(({ id, poradie, stav }) => ({ id, poradie, stav }))).toEqual(baseline);
    expect(rows[0].detail).toContain(input.workspace!.cesta);
    expect(rows[0].detail).toContain(input.workspace!.nazov);
    expect(rows[1].detail).toContain("Local provider / model-id");
    expect(rows[2].stav).toBe("caka");
    expect(rows[3].stav).toBe("volitelne");
    expect(JSON.stringify(input)).toBe(snapshot);
  }
  expect(buildSetupLedger(input, "cs")[0].nazov).toBe("Pracovní složka");
  expect(buildSetupLedger(input, "sk")[0].nazov).toBe("Pracovný priečinok");
  expect(buildSetupLedger(input, "en")[0].nazov).toBe("Working folder");
  expect(setupStatusLabel("caka", "cs")).toBe("Čeká na výběr");
  expect(setupStatusLabel("caka", "en")).toBe("Awaiting selection");
});

test("errors preserve raw diagnostics and their stable machine states in every locale", () => {
  const input: SetupLedgerInput = {
    workspace: null, workspaceChyba: "EACCES /private/example", model: null,
    ochranaUprav: null, ochranaChyba: "HTTP 403", prvaUlohaHotova: false,
    postup: DEFAULT_ONBOARDING_PROGRESS,
  };
  for (const locale of ["cs", "sk", "en"] as const) {
    const rows = buildSetupLedger(input, locale);
    expect(rows[0].stav).toBe("chyba");
    expect(rows[2].stav).toBe("chyba");
    expect(rows[0].detail).toContain("EACCES /private/example");
    expect(rows[2].detail).toContain("HTTP 403");
  }
});

test("interpolation preserves dollar replacement tokens and braces in source values literally", () => {
  const input: SetupLedgerInput = {
    workspace: { nazov: "A $& $` $' {path} B", cesta: "/work/$&/{name}/case" },
    model: { poskytovatel: "Provider {model} $&", model: "model-id" },
    ochranaUprav: "ask", prvaUlohaHotova: false, postup: DEFAULT_ONBOARDING_PROGRESS,
  };
  for (const locale of ["cs", "sk", "en"] as const) {
    const rows = buildSetupLedger(input, locale);
    expect(rows[0].detail).toContain(input.workspace!.cesta);
    expect(rows[0].detail).toContain(input.workspace!.nazov);
    expect(rows[1].detail).toContain("Provider {model} $& / model-id");
  }
});
