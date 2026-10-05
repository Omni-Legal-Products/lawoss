import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "@/i18n";
import { AiSettingsView } from "../src/react-app/domains/settings/pages/ai-view";
import { isCommercialSurfaceHidden } from "../src/lawoss/feature-flags";

const view = () =>
  renderToStaticMarkup(
    <AiSettingsView
      busy={false}
      providerAuthBusy={false}
      providerStatusLabel=""
      providerStatusStyle=""
      providerSummary=""
      connectedProviders={[{ id: "ollama", name: "Ollama", source: "config" }]}
      disconnectingProviderId={null}
      providerConnectError={null}
      providerDisconnectStatus={null}
      providerDisconnectError={null}
      onOpenProviderAuth={() => {}}
      onDisconnectProvider={() => {}}
      canDisconnectProvider={() => true}
      eigenweltConnected={false}
      onManageEigenweltAccount={() => {}}
    />,
  );

describe("AI providers without the upstream vendor account", () => {
  test("the Eigenwelt account row is hidden while own providers stay", () => {
    expect(isCommercialSurfaceHidden("eigenwelt-account")).toBe(true);
    const html = view();
    expect(html).not.toContain(t("account.connected_title"));
    expect(html).toContain("Ollama");
    expect(html).toContain(t("provider_auth.add_provider"));
  });
});
