import { afterEach, describe, expect, test } from "bun:test";

import { connectedTaskOrgId } from "../tasks-api.js";
import {
  EIGENWELT_FIRM_SERVICES_ENV,
  eigenweltFirmServicesEnabled,
  storageOAuthProviderAllowed,
} from "./commercial-services.js";

const SIGNED_IN = {
  entitlements: null,
  account: { userId: "user_ada", userName: "Ada", userEmail: "ada@kancelaria.test", orgId: "org_1", orgName: "Kancelária" },
  platformURL: "https://platform.example.test",
  platformToken: "token",
  refreshToken: "refresh",
  platformTokenExpiresAt: null,
};

const preloaded = process.env[EIGENWELT_FIRM_SERVICES_ENV];

afterEach(() => {
  if (preloaded === undefined) delete process.env[EIGENWELT_FIRM_SERVICES_ENV];
  else process.env[EIGENWELT_FIRM_SERVICES_ENV] = preloaded;
});

describe("LAWOSS: firemné služby Eigenwelt", () => {
  test("sú predvolene vypnuté", () => {
    expect(eigenweltFirmServicesEnabled({})).toBe(false);
    expect(eigenweltFirmServicesEnabled({ [EIGENWELT_FIRM_SERVICES_ENV]: "1" })).toBe(true);
  });

  test("úlohy sa nesynchronizujú ani s prihláseným účtom", () => {
    delete process.env[EIGENWELT_FIRM_SERVICES_ENV];
    expect(connectedTaskOrgId(SIGNED_IN)).toBeNull();
  });

  test("Box je dostupný len s vlastným OAuth brokerom", () => {
    expect(storageOAuthProviderAllowed("box", {})).toBe(false);
    expect(storageOAuthProviderAllowed("box", { LEGALWORK_STORAGE_BOX_OAUTH_URL: "https://broker.kancelaria.test/box/" })).toBe(true);
    expect(storageOAuthProviderAllowed("webdav", {})).toBe(true);
  });
});
