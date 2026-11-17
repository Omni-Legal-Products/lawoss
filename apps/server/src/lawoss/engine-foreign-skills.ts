/**
 * LAWOSS #530: engine nečíta ani nesleduje skilly iných nástrojov (`.claude/skills`, `.agents/skills`).
 *
 * OpenCode 2.1.4 (`packages/core/src/config/discovery.ts`) prechádza od priečinka lokácie všetky nadradené
 * priečinky až po koreň disku a každé `.claude` a `.agents` odovzdá vstavanému pluginu
 * `opencode.config.compatibility`. Ten pri každej zmene konfigurácie znova rekurzívne sleduje a načíta
 * `<priečinok>/.claude/skills` a `<priečinok>/.agents/skills`. Engine má vlastný domov (`OPENCODE_TEST_HOME`),
 * takže skutočný domov používateľa preň nie je „globálny“ a prechod nadradených priečinkov klienta
 * pod domovom doň vstúpi: engine sledoval (log: tisíce `watcher subscribe`) a do zoznamu skillov
 * pridával skilly z `~/.claude/skills` a `~/.agents/skills`, hoci ich server a desktop
 * (`claude-global-skills.ts`, `lawoss-skill-roots.mjs`) neponúkajú.
 *
 * Skilly LAWOSS dostáva engine výslovne v `skills` konfigurácie (`legalwork-runtime-config.ts`,
 * `lawoss-outside-config.ts`), vrátane `.claude/skills` a `.opencode/skills` vnútri priečinka klienta.
 * Kompatibilný plugin preto LAWOSS vypne direktívou v povinnej konfigurácii a `.claude` vypne aj
 * premennou enginu (`config.claude: false` v `packages/cli/src/server-process.ts`). Bez neho engine
 * nenačíta ani `.agents/skills` vnútri priečinka klienta (server ich nikdy neponúkal).
 *
 * Neplatí pre `.opencode` a `opencode.json(c)` v nadradených priečinkoch (napr. `~/.opencode`): tie
 * prechod stále načíta a sleduje, vypnúť sa dajú len zásahom do enginu.
 */

/** Direktíva povinnej konfigurácie enginu: vstavaný plugin skillov `.claude`/`.agents` sa nespustí. */
export const LAWOSS_DISABLED_ENGINE_PLUGINS = ["-opencode.config.compatibility"] as const;

/** Premenná enginu: žiadne korene `.claude` (globálne ani nadradené) v zdrojoch konfigurácie. */
export const LAWOSS_FOREIGN_SKILLS_ENGINE_ENV = { OPENCODE_DISABLE_CLAUDE_CODE: "1" } as const;
