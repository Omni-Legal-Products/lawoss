import { expect, test } from "bun:test";
import { lawossSlashCommands } from "../src/lawoss/chat/slash-commands";

const commands = [
  { id: "cmd:init", name: "init", description: "guided AGENTS.md setup", source: "command" as const },
  { id: "cmd:review", name: "review", source: "command" as const },
  { id: "cmd:open", name: "open", description: "Open a file", source: "command" as const },
];
const skills = [
  { name: "novy-spis", path: "/x/novy-spis/SKILL.md", description: "Založí nový spis" },
  { name: "open", path: "/x/open/SKILL.md" },
  { name: "de-civil-deadlines", path: "/x/de/SKILL.md" },
];

test("ponuka „/“: skilly klienta najprv, bez príkazov pre vývojárov a skrytých balíkov lehôt", async () => {
  const options = await lawossSlashCommands(async () => commands, async () => skills);
  expect(options.map((option) => `${option.source}:${option.name}`)).toEqual(["skill:novy-spis", "command:open"]);
});

test("zlyhanie jedného zdroja nezruší druhý", async () => {
  const onlySkills = await lawossSlashCommands(async () => { throw new Error("engine"); }, async () => skills.slice(0, 1));
  expect(onlySkills.map((option) => option.name)).toEqual(["novy-spis"]);
  const onlyCommands = await lawossSlashCommands(async () => commands, async () => { throw new Error("server"); });
  expect(onlyCommands.map((option) => option.name)).toEqual(["open"]);
});
