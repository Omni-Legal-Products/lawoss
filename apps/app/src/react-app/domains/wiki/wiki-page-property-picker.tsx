import { useMemo, useState } from "react";
import { Check, FileText, Plus, X } from "lucide-react";
import type { WikiPage } from "@legalwork/types/wiki";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/i18n";
import { resolveWikiPage } from "./wiki-model";

type Props = {
  name: string;
  value: string | string[] | null;
  multiple: boolean;
  pages: WikiPage[];
  path: string;
  onChange: (value: string | string[] | null) => void;
  onOpen: (path: string) => void;
};

export function WikiPagePropertyPicker(props: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const values = Array.isArray(props.value) ? props.value : props.value && props.value !== "[[]]" ? [props.value] : [];
  const links = values.map(value => ({ value, page: resolveWikiPage(props.pages, value, props.path) }));
  const matches = useMemo(() => {
    const search = query.trim().normalize("NFC").toLocaleLowerCase();
    const found: WikiPage[] = [];
    for (const page of props.pages) {
      if (!search || `${page.title}\n${page.path}`.normalize("NFC").toLocaleLowerCase().includes(search)) found.push(page);
      if (found.length === 100) break;
    }
    return found;
  }, [props.pages, query]);
  const remove = (value: string) => props.onChange(props.multiple ? values.filter(item => item !== value) : null);
  return <div className="wiki-property-relations flex min-w-0 flex-wrap items-center gap-1 py-1">
    {links.map(({ value, page }) => <span key={value} className="wiki-property-relation inline-flex max-w-full items-center rounded-md border bg-muted/30 text-xs">
      <button type="button" className="wiki-property-link flex min-w-0 items-center gap-1 rounded-l-md px-2 py-1 text-left hover:bg-muted disabled:cursor-default disabled:text-muted-foreground" disabled={!page} title={page?.path ?? value} onClick={() => { if (page) props.onOpen(page.path); }}>
        <FileText className="size-3 shrink-0" /><span className="truncate">{page?.title ?? value.slice(2, -2).split("|").at(-1)}</span>
      </button>
      <button type="button" aria-label={`${t("wiki.remove_property_page")}: ${page?.title ?? value}`} className="wiki-property-remove shrink-0 rounded-r-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => remove(value)}><X className="size-3" /></button>
    </span>)}
    <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery(""); }}>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" className="wiki-property-relation-add h-7 max-w-full gap-1 px-2 text-xs text-muted-foreground" />} aria-label={`${t("wiki.select_property_page")}: ${props.name}`}>
        <Plus className="size-3.5" />{!values.length && t("wiki.select_property_page")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(360px,calc(100vw-32px))] gap-0 overflow-hidden p-0">
        <Command items={matches} filter={null} value={query} onValueChange={setQuery}>
          <CommandInput aria-label={t("wiki.graph_search")} placeholder={t("wiki.graph_search")} className="h-10 w-full" />
          <CommandEmpty>{t("wiki.no_matching_pages")}</CommandEmpty>
          <CommandList className="max-h-64 overflow-y-auto">
            {matches.map(page => {
              const selected = links.find(link => link.page?.path === page.path);
              return <CommandItem key={page.path} value={page.path} className="gap-2 rounded-md px-2" onClick={() => {
                if (selected && props.multiple) remove(selected.value);
                else props.onChange(props.multiple ? [...values, `[[${page.path}]]`] : `[[${page.path}]]`);
                if (!props.multiple) setOpen(false);
              }}>
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm">{page.title}</span><span className="block truncate text-xs text-muted-foreground">{page.path}</span></span>
                {selected && <Check className="size-4 shrink-0" />}
              </CommandItem>;
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </div>;
}
