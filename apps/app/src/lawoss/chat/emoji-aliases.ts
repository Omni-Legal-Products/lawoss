/**
 * #571: skratky `:meno:` pre `marked-emoji`. Upstream bral každé kľúčové slovo `emojilib` (6 272), aj čísla a krátke
 * slová, takže „1:2:3“ sa v chate zmenilo na „1🕑3“ a „127.0.0.1:9:80“ na „127.0.0.1🕘80“. Skratka musí byť meno:
 * začína písmenom, má aspoň 3 znaky a aspoň 2 písmená. Pomery, časy, adresy a slová ako `na`, `je`, `v` ostanú textom.
 */
const SHORTCODE = /^[a-z][a-z0-9_+-]{2,}$/;

const isShortcodeName = (name: string): boolean => SHORTCODE.test(name) && (name.match(/[a-z]/g)?.length ?? 0) >= 2;

export function emojiShortcodeAliases(keywords: Record<string, readonly string[]>): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const [emoji, names] of Object.entries(keywords)) {
    for (const name of names) if (isShortcodeName(name) && aliases[name] === undefined) aliases[name] = emoji;
  }
  return aliases;
}
