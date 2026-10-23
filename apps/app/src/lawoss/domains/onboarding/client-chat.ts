/**
 * Chat s klientom po pridaní existujúceho priečinka (MČ 19. 10. 2026): agent prejde obsah a navrhne
 * prípady, presuny až po schválení advokáta. Prvá správa sa len pripraví do poľa správy (ako rýchle
 * akcie a upstream New Task); odošle ju advokát, ktorý ju pred odoslaním poskytovateľovi vidí.
 * Bez Reactu a bez spojenia, aby sa poradie krokov dalo otestovať.
 */
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { AiBoundaries } from "@legalwork/types/ai-governance";
import type { ModelRef } from "@/app/types";
import { matterModelGap } from "../../lite/matter-model";
import type { SkillAvailability } from "../../okf/skill-availability";
import type { FoundTextKey } from "./found-text";

type Text = (key: FoundTextKey, params?: Record<string, string | number>) => string;

/** Prečo sa chat neotvoril: bez modelu, zapnuté AI hranice, alebo zlyhanie (engine, skill, založenie chatu). */
export type ClientChatUnavailable = "no-model" | "boundaries" | "failed";
export type ClientChatOutcome = { route: string } | { unavailable: ClientChatUnavailable };
/** Chat v priečinku klienta: id pracovného priečinka (ak ho výsledok nesie), jeho cesta a prvá správa. */
export type ClientChatRequest = { workspaceId?: string; directory: string; prompt: string };

/** Prvá správa agentovi zo slovníka; meno klienta ide ako JSON, aby nepridalo pokyn (ako rýchle akcie). */
export function clientChatPrompt(text: Text, name: string): string {
  return text("chatPrompt", { client: JSON.stringify(name) });
}

/** Poškodená hodnota hraníc platí ako zapnuté (`AiBoundaries.source === "invalid"`). */
const boundariesOn = (boundaries: AiBoundaries | null | undefined): boolean => boundaries?.enforced === true || boundaries?.source === "invalid";

/**
 * Čo chatu chýba. Model podľa rovnakých pravidiel ako rýchle akcie (`matterModelGap`): jeden pripojený
 * poskytovateľ stačí, chat si model vyberie sám; inak treba pripojiť alebo vybrať model.
 */
export function clientChatGap(input: { boundaries: AiBoundaries | null | undefined; defaultModel: ModelRef | null | undefined; providerList: ProviderListResponse }): "boundaries" | "no-model" | null {
  if (boundariesOn(input.boundaries)) return "boundaries";
  return matterModelGap(input.defaultModel, input.providerList) ? "no-model" : null;
}

/**
 * Skill na založenie prípadu, ktorý chat potrebuje (`NOVY_SPIS_SKILL_NAME`). Meno je tu zopakované:
 * `skill-bundle` nesie celé CLI a onboarding ho načíta až pri inštalácii (`okfSkillPack`); test zhodu stráži.
 */
export const CLIENT_CHAT_SKILL = "novy-spis";

export type ClientChatDeps = {
  /** Stav AI hraníc zo servera (`aiGovernance`). */
  governance(): Promise<AiBoundaries | undefined>;
  /** Zoznam poskytovateľov z enginu priečinka klienta (ten istý, ktorý číta composer). */
  providerList(): Promise<ProviderListResponse>;
  defaultModel: ModelRef | null | undefined;
  /** Balík skillov OKF do priečinka klienta (/novy-spis, /roztried-spis, /usporiadaj-spis …). */
  installSkills(): Promise<unknown>;
  /** Či engine priečinka skill vidí; pri potrebe ho obnoví (`ensureSkillAvailable`). */
  skillAvailability(name: string): Promise<SkillAvailability>;
  /** Založí chat v priečinku klienta s pripravenou správou a vráti trasu. */
  open(): Promise<string>;
};

/**
 * Najprv hranice a model (nič nezapisujú), potom skilly a ich viditeľnosť v engine, až potom chat.
 * Nedostupný stav hraníc neblokuje: hranice vynucuje server a odmietnutie odoslania chat ohlási vetou.
 * Skilly sú pomôcka, nie podmienka (N-A2-4, MČ 23. 10. 2026): prvá správa je obyčajný text, prehľad
 * a návrh prípadov ich nepotrebujú a správa agentovi káže povedať na rovinu, keď skill odmietne. Chat sa
 * preto otvorí aj vtedy, keď sa balík nenainštaluje alebo ho engine nevidí; slepá ulička by advokátovi
 * nedala nič. Zlyhanie zoznamu poskytovateľov alebo založenia chatu vráti `failed`.
 */
export async function prepareClientChat(deps: ClientChatDeps): Promise<ClientChatOutcome> {
  try {
    const boundaries = await deps.governance().catch((reason: unknown) => { console.warn("[lawoss] AI boundaries before client chat", reason); return undefined; });
    const gap = clientChatGap({ boundaries, defaultModel: deps.defaultModel, providerList: await deps.providerList() });
    if (gap) return { unavailable: gap };
    const skills = await prepareChatSkill(deps);
    if (skills !== "ready" && skills !== "reloaded") console.warn("[lawoss] client chat opens without the OKF skill", CLIENT_CHAT_SKILL, skills);
    return { route: await deps.open() };
  } catch (reason) {
    console.warn("[lawoss] client chat after adding a folder", reason);
    return { unavailable: "failed" };
  }
}

/** Balík skillov a viditeľnosť /novy-spis; zlyhanie inštalácie alebo overenia je `missing`, nie výnimka. */
async function prepareChatSkill(deps: Pick<ClientChatDeps, "installSkills" | "skillAvailability">): Promise<SkillAvailability> {
  try {
    await deps.installSkills();
    return await deps.skillAvailability(CLIENT_CHAT_SKILL);
  } catch (reason) {
    console.warn("[lawoss] OKF skills before client chat", reason);
    return "missing";
  }
}
