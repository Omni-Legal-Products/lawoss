# ChatGPT subscription smoke in GitHub Actions

This is a manually authorized native-engine probe, not full application or release acceptance.
It uses the engine's own `chatgpt-headless` OAuth method and ChatGPT-plan connection. It never
treats an OAuth token as an API key, copies an existing login, or falls back to paid API access.

## Scope

- Runners: `macos-15` (ARM64), `windows-2022` (x64), `windows-11-arm` (ARM64), sequentially.
- Exact workflow commit on `dev`, the reviewed engine distribution and its independent manifest.
- A fresh disposable native-engine profile on each runner, followed by restart of that same profile.
- One explicit model ID from the application's subscription allowlist, with no model substitution.
- Two short synthetic prompts per platform, each requesting a fixed marker and no tools.
- Existing-application-profile migration, rendered UI, client isolation, approval cards, files,
  Word, installer and RAM acceptance are **not run by this probe**. The report says so explicitly.

The native device method is labelled legacy by the engine. An account that cannot use it is
blocked; do not work around account policy, MFA, rate limits or subscription restrictions.
OAuth expiry, missing model and operator cancellation are not passes.

## Secure operator setup

Do this locally, not in an Actions step. Keep the private key outside every repository and cloud artifact.
The example uses Bash; enter a local passphrase of at least 16 characters without putting it in shell history:

```bash
read -r -s -p 'Local key passphrase: ' CHATGPT_KEY_PASSPHRASE
export CHATGPT_KEY_PASSPHRASE
node lawoss/testing/chatgpt/challenge.mjs keygen "$HOME/chatgpt-acceptance-key"
```

The new directory must not already exist. The helper creates an encrypted private PEM with mode
0600 (Windows users must also restrict the directory's ACL) and `public.txt`. Only the base64 DER
public key is printed. Its passphrase and private key never go to GitHub. No API-key secret is required.

## Run

The workflow must first be reviewed and present on `dev`. Do not change its trusted-ref guard to
run login against arbitrary PR code. In the GitHub Actions UI choose
**ChatGPT subscription smoke (manual OAuth)** on `dev`, supply the exact model ID and the contents
of `public.txt`, and explicitly authorize use of the subscription. The dispatched source SHA is
the candidate; it does not silently track later merges.

Only one run and one platform execute at a time. Wait for the artifact named
`chatgpt-device-<runner>-<run-id>-<attempt>` to appear. Its `challenge.json` is AES-GCM encrypted,
with the symmetric key wrapped to the operator RSA key using OAEP-SHA256. It contains only the
allowlisted device URL/user code, expiry and run/model/platform identity, not OAuth tokens.
The artifact expires after one day; the device login itself expires much sooner (at most ten minutes).

Download that artifact to a private local directory and decrypt locally:

```bash
node lawoss/testing/chatgpt/challenge.mjs decrypt \
  /private/local/path/challenge.json "$HOME/chatgpt-acceptance-key/private.pem"
```

Check the **run, attempt, SHA, platform and model** against the run you intentionally started.
Manually visit the exact official URL `https://auth.openai.com/codex/device`, enter its code and
review which account you authorize. Never approve a code from someone else's run, even if it is
on the official website. Do not paste the plaintext code, passwords, MFA codes or tokens into
GitHub logs/issues/chat. The helper refuses decryption in Actions. Repeat for each platform.

## Verification and cleanup

Before any prompt, the probe requires an active OAuth connection and the exact requested model.
After restart it checks both again. Only the exact expected text passes; HTTP success alone does not.
There is no fallback, response retry loop, tool execution or access to client documents.

The engine inherits no ambient provider credentials, GitHub token, proxy configuration or global
model configuration. Its home, config, data, cache, state, temporary directory and database are
inside its private disposable profile. The worker uses the normal managed-engine lifecycle and
stdin lease; final cleanup stops the engine and removes that profile before reporting success.
A stopped workflow also has an `always()` cooperative cleanup step. Forced runner termination
still relies on GitHub destroying the ephemeral runner; it is not a successful cleanup receipt.
Removing a local profile does not prove remote OAuth grant revocation. Use an appropriate test
account and review/revoke the test devices in the account's supported security settings afterwards.

Only `public/challenge.json` and `public/report.json` are uploaded using exact paths. No raw logs,
profiles, databases, captured HTTP bodies, access/refresh tokens or arbitrary exceptions are artifacts.
Raw engine exceptions are not printed. Results use finite stage/code categories and explicitly
report `fullApplicationAcceptance` and `migrationAcceptance` as `not-run`.

ChatGPT-plan usage limits still apply. Agent steps and inference time are bounded, auxiliary
title/summary agents are disabled, and prompts are small. **This is not a hard token or monetary
cap**: the native ChatGPT backend controls output limits and may reject requested output caps.
Do not claim an exact network-request count merely from the two logical prompts.

## Offline regression checks

```bash
node --test lawoss/testing/chatgpt/challenge.test.mjs
bun test ./lawoss/testing/chatgpt/challenge.test.mjs
pnpm --filter legalwork-server exec bun test src/chatgpt-subscription-probe.test.ts
pnpm --filter legalwork-server exec tsc -p tsconfig.subscription-probe.json
```

These use generated synthetic keys and a loopback SDK fixture; they make no OpenAI request.
They prove encryption, trusted workflow/upload boundaries and native protocol control logic,
not live device login or successful Windows execution. A real Actions report is required for those.
