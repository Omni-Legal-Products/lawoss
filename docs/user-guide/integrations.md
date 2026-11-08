# Integrations

Open in LegalWork: [Connectors](legalwork://app/settings/extensions/mcp), [Plugins](legalwork://app/settings/extensions/plugins).

## Connectors, storage, skills and plugins

Open **Settings > Integrations**. Its tabs separate **Plugins**, **Skills** and **File storage**. Connectors appear in the Plugins library. A catalogue entry is an available integration, not proof it is connected.

To add a connector, press **Add**, choose **Plugins** to open the **Plugin catalogue**, then search for and select the connector, such as **Gmail** or **Outlook Email**. Follow its setup flow. Do not skip **Add** when the connector has not been added yet. To manage an existing connector, open its entry in the library. Some use browser sign-in; others need an API key, local command or remote MCP URL. A custom MCP connection can use the supported local-command or remote-server configuration. Complete authentication and check its connection status. Reload the agent when the app requests it so the new tools become available.

An MCP server publishes tools with its own access requirements. Local-command integrations run on the computer running LegalWork, so required software and credentials must exist there. A remote MCP URL connects to the external service instead of starting its program locally. A disabled connector or expired authorization can leave a card visible while its tools fail or are absent.

Creating a custom plugin saves it to your shared library and prepares it for the current project. Other projects receive it automatically, including when you next open them; creation does not wait for every project to connect. When the new connector uses browser sign-in (OAuth), sign-in opens automatically after creation. Complete it in your browser to make the connector's tools available. If you cancel, you can open the plugin later and choose **Sign in** to retry. API-key, no-authentication and local-command connectors do not open browser sign-in.

Removing a shared plugin removes its bundled connectors and skills from every project. Open projects update automatically; unopened projects use the updated shared library when opened. The settings list updates without a manual refresh, and removal does not wait for any project's engine to start or reconnect.

Plugins add OpenCode tools or hooks. Use the Plugins tab's supported installation/import flow, including the Claude-plugin bundle preview when offered. Previewing a package does not establish that every third-party component works in this runtime. Follow any reported compatibility errors. Most repeatable drafting procedures need a skill or workflow rather than a custom plugin.

## Research databases

The **Your legal research** welcome screen helps you connect accounts you already use, including beck-online, juris, Lexis and Westlaw. Country suggestions cover the EU, UK and US. They are a starting list, not a guarantee that your subscription covers a particular matter or jurisdiction.

1. During onboarding, choose the country you work in. For later setup, save a website login under **Settings > Secrets > Browser passwords**.
2. Select one or more suggested databases. Search by name, such as “Beck”, to search all countries. Choose **Add another database** for an unlisted service, enter its name and **Research website**, and provide its **Sign-in website (if different)** when the provider uses a separate login website.
3. Choose **Set up selected databases** or **Set up integration**. Each selected service gets its own **Sign-in details needed** card. The website is already filled in for verified login addresses. If a provider’s current login address could not be confirmed, enter the address of its password page first. Enter your username and password, then choose **Save and continue**. If a matching login is already saved, choose **Continue with saved login** instead.
4. Continue after the integrations have been added. Use **Set up later** to skip optional setup. Find the result under **Settings > Secrets > Browser passwords**; it is available in all your projects on this LegalWork installation.
5. Ask, for example, “Research this question in beck-online and cite the relevant judgments.” The assistant opens the provider in **Browser Automation**, signs in with the saved login and checks access. Complete any MFA, CAPTCHA or institutional sign-in in the visible browser when requested.

You can also ask in any chat: “Set up CourtListener for your legal research.” For a known provider, the assistant opens the same **Sign-in details needed** card directly, with the saved provider address. Enter your credentials or choose **Continue with saved login**. It then checks access in the browser. This also works for any other website: provide its sign-in URL, or the assistant asks you for it, then shows the same card directly.

Website logins use LegalWork's existing encrypted vault. Onboarding, the chat sign-in card and **Settings > Secrets > Browser passwords** all save to this same store, available across your chats on this installation. Secrets is the single management screen for adding, editing and deleting these logins. Each entry has its sign-in website and can link several destinations, for example two services using the same sign-in account. Destination URLs do not expand where a password can be filled.

Saving a login does not install a plugin or create a site-specific skill. The built-in **legal-research** skill is available in every project. For legal research, the assistant discovers saved websites, selects suitable research sources, and uses a site-specific skill if one is installed. Otherwise it uses the observed website controls. The country list only helps fill in provider URLs. A normal website and a research database use exactly the same login mechanism.

The general research skill keeps persistent operational notes for each connected website: observed problems, attempted steps and verified recoveries. These notes help later chats, but must be checked against the current website. They contain no account details, credentials, raw page text or legal findings. Ask the assistant to show or forget a site's notes. Existing optional site skills can also keep their own experience log. Notes do not change login permissions. Organization restrictions on custom skills can prevent saving new notes; the assistant reports that limitation.

**Libra (Wolters Kluwer)** is a suggested provider. Ask “Set up Libra” for its secure login card, or select it during onboarding. LegalWork opens `app.libratech.ai` to start sign-in; the saved sign-in domain is `auth.libratech.ai`. For research, the bundled **libra-research** skill submits your question to Libra's agent chat, checks for completion in waits of up to 30 seconds, and stops after five minutes unless you set another limit. It preserves the conversation on timeout so you can ask it to check again without submitting the task twice. Completed answers are reviewed with their cited sources. Source collections depend on your Libra subscription and add-ons. See [Libra's source coverage](https://libratech.ai/product/legal-content).

Research findings belong in **Legal Research** or **Rechtliche Recherche**, which LegalWork prepares automatically. The assistant first asks whether you want the identified legal findings prepared for your knowledge base. After your consent it stages legal knowledge only, with citations and classification by jurisdiction, area of law and issue. Review the proposed contribution and choose **Save to wiki** to publish. Website mechanics, workflows and login fixes stay outside this wiki. See [the wiki guide](wiki.md).

If sign-in redirects between subdomains of the same main domain, your login remains available. If the provider uses a separate main domain, save the login for the actual password page. Setup does not prove the login works: the assistant checks access in the browser during research. Complete MFA, CAPTCHA or institutional sign-in there when needed. For a free account test, choose **United States > CourtListener**; its sign-in supports a free username/password account. Some separate document services may charge for retrieval, so a free account does not imply every linked source is free.

## LegalMemory and firm knowledge

LegalMemory is a separate Eigenwelt knowledge index. Connect the firm's instance using its connector when available. Search its live records for matters, documents and other firm knowledge; inspect the returned source evidence. Connecting ordinary file storage does not automatically create a LegalMemory index.

A disconnected connector's historical output, old chats or runtime caches are not substitutes for the live source. If the firm has not connected LegalMemory, use the source the user identifies or the available connected storage. A failed search is not evidence that the matter does not exist everywhere.

## Google Workspace and other services

Upgrading the engine carries over completed MCP connector sign-ins, including those used by LegalMemory browsing and downloads. A newer sign-in already saved in the app takes precedence, and disconnecting afterward stays disconnected. A sign-in that was never completed, or that the service has expired or revoked, may still require signing in again through the connector's card.

For Gmail and Outlook setup, connection methods, write permissions and troubleshooting, read [Email setup](email.md). The native catalog also includes Google Calendar, Outlook Calendar, Google Drive, OneDrive and SharePoint. Each connector has its own supported operations and write-access setting. Outlook Email and Calendar share an account but activate separately.

Connecting a calendar service lets the assistant use that service's available tools. It does not automatically import those events into LegalWork's project Calendar. Connecting a drive does not establish mail access. Check the individual connector's status and granted permissions.

## Browser and Computer Use

The built-in browser opens websites in a browser panel. Ask the assistant to open a URL and inspect the page with the browser tools. Opening or reconnecting a tab gives the assistant a page observation it can use directly for searches, forms, links and other interactions. It can perform known steps together, then inspect the result; a new page or an unexpected result requires another observation. For saved website passwords, use **Settings > Secrets > Browser passwords**; see [browser password setup and limits](settings-privacy.md#browser-passwords). Filling uses the existing tab. Background task tabs remain available after the assistant finishes, so you can reopen them from their chat cards or continue in the same tab on a follow-up. Close a tab when you no longer need it. Website sign-ins, downloads and site permissions are separate from LegalWork model-provider sign-in. Inspect the returned file location after downloading.

Computer Use controls desktop applications and is configured from its integration card. The built-in desktop integration in this build targets macOS and requires Accessibility and Screen Recording permissions. Use its setup/test controls to confirm readiness. For LegalWork's own navigation, prefer the app's UI action tools so the assistant can open settings or sessions directly. Browser automation is for web content, not an assumption that LegalWork's native controls are a website.

Additional integrations, including media capabilities, depend on installed packages and their credentials. The live catalog and returned tool descriptions are authoritative for those tools.

Related: [Storage](connected-storage.md), [Skills](skills-workflows.md), [Audio](audio.md), [Feature availability](feature-availability.md).
