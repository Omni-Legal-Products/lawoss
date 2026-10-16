import type { WikiPage, WikiValue } from "@legalwork/types/wiki";
import { t } from "@/i18n";
import { resolveWikiPage, wikiValueText } from "./wiki-model";

export function WikiPropertyValue(props: { value: WikiValue | undefined; pages: WikiPage[]; fromPath: string; onOpen: (path: string) => void }) {
  if (Array.isArray(props.value)) return <span className="inline-flex flex-wrap gap-x-1">{props.value.map((value, index) => <span key={index}><WikiPropertyValue {...props} value={value} />{index < (Array.isArray(props.value) ? props.value.length : 0) - 1 ? ", " : ""}</span>)}</span>;
  const text = wikiValueText(props.value);
  const match = /^\[\[([^\]]+)\]\]$/.exec(text);
  if (match) {
    const target = resolveWikiPage(props.pages, match[1], props.fromPath);
    const [path, alias] = match[1].split("|");
    const label = alias || target?.title || path;
    return target ? <button className="text-left text-primary underline underline-offset-2" onClick={() => props.onOpen(target.path)}>{label}</button> : <span title={t("wiki.missing_link")} className="text-muted-foreground underline decoration-dotted">{label}</span>;
  }
  return <>{text || "–"}</>;
}
