import { markdown$, muteChange$, realmPlugin, setMarkdown$, viewMode$ } from "@mdxeditor/editor";
import type { PristineMarkdown } from "./pristine";

/** Observe imports even when MDXEditor deliberately mutes its public onChange. */
export const pristineMarkdownPlugin = realmPlugin<{
  onImport: (pristine: PristineMarkdown) => void;
  onMode: (mode: string) => void;
}>({
  init(realm, params) {
    let source: string | null = null;
    realm.sub(setMarkdown$, (markdown) => {
      source = markdown;
      // Equal canonical content can skip import; syntax-only source edits still count.
      params?.onImport({ source, normalized: realm.getValue(markdown$) });
    });
    realm.sub(markdown$, (normalized) => {
      if (source !== null && realm.getValue(muteChange$)) {
        params?.onImport({ source, normalized });
      }
    });
    realm.sub(viewMode$, (mode) => params?.onMode(mode));
  },
});
