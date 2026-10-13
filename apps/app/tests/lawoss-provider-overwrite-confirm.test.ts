import { describe, expect, test } from "bun:test";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { patchProviderConfirmingOverwrite, providerOverwriteConflictsFrom } from "../src/lawoss/providers/overwrite-confirm";

const conflicts = [{ providerId: "ollama", workspaces: [{ id: "second", name: "Klient B" }] }];
const conflictError = () => new LegalworkServerError(409, "provider_conflict", "conflict", { providerConflicts: conflicts });

describe("prepis poskytovateľa u ďalších klientov", () => {
  test("rozpozná len 409 provider_conflict so zoznamom priečinkov", () => {
    expect(providerOverwriteConflictsFrom(conflictError())).toEqual(conflicts);
    expect(providerOverwriteConflictsFrom(new LegalworkServerError(409, "storage_conflict", "x", { providerConflicts: conflicts }))).toBeNull();
    expect(providerOverwriteConflictsFrom(new LegalworkServerError(500, "provider_conflict", "x"))).toBeNull();
    expect(providerOverwriteConflictsFrom(new Error("x"))).toBeNull();
  });

  test("po potvrdení pošle požiadavku znova s confirmProviderOverwrite", async () => {
    const calls: boolean[] = [];
    const asked: unknown[] = [];
    const result = await patchProviderConfirmingOverwrite(async (confirm) => {
      calls.push(confirm);
      if (!confirm) throw conflictError();
      return "ok";
    }, { confirm: async (request) => { asked.push(request); return true; } });
    expect(result).toBe("ok");
    expect(calls).toEqual([false, true]);
    expect(asked).toEqual([{ conflicts, mode: "save" }]);
  });

  test("zrušenie skončí chybou a druhá požiadavka sa nepošle", async () => {
    const calls: boolean[] = [];
    const run = patchProviderConfirmingOverwrite(async (confirm) => {
      calls.push(confirm);
      throw conflictError();
    }, { mode: "remove", confirm: async (request) => request.mode !== "remove" });
    await expect(run).rejects.toThrow();
    expect(calls).toEqual([false]);
  });

  test("iná chyba sa nepýta a prepadne bez zmeny", async () => {
    const other = new LegalworkServerError(500, "internal_error", "boom");
    let asked = false;
    await expect(patchProviderConfirmingOverwrite(async () => { throw other; }, { confirm: async () => { asked = true; return true; } })).rejects.toBe(other);
    expect(asked).toBe(false);
  });
});

describe("zmena adresy servera (MČ 13. 10. 2026)", () => {
  test("dôvod endpoint_change prejde z 409 a dialóg hovorí o novej adrese", async () => {
    const { hasEndpointChange, providerOverwriteMessage } = await import("../src/lawoss/providers/overwrite-confirm");
    const endpoint = [{ providerId: "ollama", reason: "endpoint_change" as const, workspaces: [{ id: "second", name: "Klient B" }] }];
    const parsed = providerOverwriteConflictsFrom(new LegalworkServerError(409, "provider_conflict", "x", { providerConflicts: endpoint }));
    expect(parsed).toEqual(endpoint);
    expect(hasEndpointChange(parsed ?? [])).toBe(true);
    expect(hasEndpointChange(conflicts)).toBe(false);
    expect(providerOverwriteMessage(endpoint, "save")).not.toBe(providerOverwriteMessage(conflicts, "save"));
    expect(providerOverwriteMessage(endpoint, "save")).toContain("Klient B");
  });
});
