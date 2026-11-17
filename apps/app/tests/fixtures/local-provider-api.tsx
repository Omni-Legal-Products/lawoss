import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ProviderAuthModal from "../../src/react-app/domains/connections/provider-auth/provider-auth-modal";
import type { CustomProviderEditData, CustomProviderInstallInput } from "../../src/react-app/domains/connections/provider-auth/store";
import { setLanguagePreference } from "../../src/i18n";

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const modelId = "qwen2.5:fixture";
let generation = 0;
let submissions: CustomProviderInstallInput[] = [];
let fetches: string[] = [];
let closes = 0;

function Fixture({ edit }: { edit?: CustomProviderEditData }) {
  const [open, setOpen] = useState(true);
  return <ProviderAuthModal
    open={open}
    allowChatGptSubscription={false}
    loading={false}
    submitting={false}
    error={null}
    providers={[]}
    connectedProviderIds={[]}
    authMethods={{}}
    customEdit={edit}
    onSelect={async () => { throw new Error("Unexpected OAuth selection"); }}
    onSubmitApiKey={async () => { throw new Error("Unexpected API-key submission"); }}
    onSubmitOAuth={async () => { throw new Error("Unexpected OAuth submission"); }}
    onFetchCustomModels={async input => { fetches.push(input.baseURL); return [modelId]; }}
    onSubmitCustomProvider={async input => { submissions.push(structuredClone(input)); }}
    onClose={() => { closes++; setOpen(false); }}
  />;
}

Object.assign(window, { localProviderApiFixture: {
  setup(baseURL?: string, chatCompletionsOnly = false, providerId = "synthetic-provider") {
    submissions = []; fetches = []; closes = 0;
    setLanguagePreference("en");
    // Deliberately not a known runtime ID: loopback detection must repair stale Responses.
    const edit: CustomProviderEditData | undefined = baseURL === undefined ? undefined : {
      providerId,
      name: "Synthetic provider",
      baseURL,
      endpointConfigured: true,
      chatCompletionsOnly,
      apiType: "responses",
      models: [{ id: modelId, toolCall: true, reasoning: false, contextLimit: null, outputLimit: null }],
    };
    flushSync(() => root.render(<Fixture key={++generation} edit={edit} />));
  },
  state: () => ({ submissions, fetches, closes }),
} });
