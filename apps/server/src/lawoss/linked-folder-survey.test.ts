// LAWOSS alfa2 A3 (review m2, m3): prieskum pripájaného priečinka nepovolí potichu, keď nedobehne, hľadá kanceláriu
// bez ohľadu na veľkosť písmen aj priamo v podpriečinku a výnimku pre pamäť kancelárie dá len vlastnej praxi.
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { surveyLinkedFolder } from "./linked-folder-survey.js";

const roots: string[] = [];
const locked: string[] = [];
afterEach(async () => {
  while (locked.length) await chmod(locked.pop()!, 0o755).catch(() => {});
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});
const temp = async () => { const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-survey-"))); roots.push(root); return root; };

test("nečitateľný podpriečinok alebo priveľa podpriečinkov: aspoň otázka, nie ticho povolené", async () => {
  const root = await temp();
  const unreadable = join(root, "Zdieľané");
  await mkdir(join(unreadable, "Zamknuté"), { recursive: true });
  await mkdir(join(unreadable, "Voľné"), { recursive: true });
  await chmod(join(unreadable, "Zamknuté"), 0o000); locked.push(join(unreadable, "Zamknuté"));
  expect(await surveyLinkedFolder(unreadable, null)).toEqual({ kind: "practice_like", clients: [] });
  const many = join(root, "Archív");
  await Promise.all(Array.from({ length: 1001 }, (_, i) => mkdir(join(many, `Zložka ${i}`), { recursive: true })));
  expect(await surveyLinkedFolder(many, null)).toEqual({ kind: "practice_like", clients: [] });
  // Chýbajúci priečinok nie je chyba prieskumu.
  expect(await surveyLinkedFolder(join(root, "Neexistuje"), null)).toBeNull();
});

test("okf.config priamo v podpriečinku a kancelária malými písmenami sú prax", async () => {
  const root = await temp();
  await mkdir(join(root, "A", "Kancelária"), { recursive: true });
  await writeFile(join(root, "A", "Kancelária", "okf.config"), "office: A\n");
  expect(await surveyLinkedFolder(join(root, "A"), null)).toEqual({ kind: "practice" });
  await mkdir(join(root, "B", "office"), { recursive: true });
  await writeFile(join(root, "B", "office", "okf.config"), "office: B\n");
  expect(await surveyLinkedFolder(join(root, "B"), null)).toEqual({ kind: "practice" });
  await mkdir(join(root, "C", "Prax", "OFFICE"), { recursive: true });
  await writeFile(join(root, "C", "Prax", "OFFICE", "okf.config"), "office: C\n");
  expect(await surveyLinkedFolder(join(root, "C"), null)).toEqual({ kind: "practice" });
});

test("výnimka pamäte kancelárie len pre kanceláriu vlastnej praxe, nie pre Office vyššie", async () => {
  const root = await temp();
  const own = join(root, "Dáta", "Prax", "Klienti", "Tatran");
  await mkdir(own, { recursive: true });
  for (const office of [join(root, "Dáta", "Prax", "Office"), join(root, "Office")]) {
    await mkdir(office, { recursive: true });
    await writeFile(join(office, "okf.config"), "office: X\n");
  }
  expect(await surveyLinkedFolder(join(root, "Dáta", "Prax", "Office"), own)).toBeNull();
  expect(await surveyLinkedFolder(join(root, "Office"), own)).toEqual({ kind: "practice" });
});
