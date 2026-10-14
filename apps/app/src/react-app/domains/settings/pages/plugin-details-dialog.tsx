import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Loader2, Package, Search } from "lucide-react";
import type { ImportedPlugin, ImportedPluginFile } from "@/app/lib/extension-imports";
import type { SkillCard } from "@/app/types";
import { MarkdownBlock } from "@/components/markdown/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import { SkillDetailsDialog, type SkillDetailsStore } from "./skill-details-dialog";
import { ImportedPackageContents, packageParts, pluginComponentLabel, pluginFileInstalledName } from "./plugin-package-contents";
import { pluginImportName } from "./plugin-import-presentation";

export type PluginDetailsAccess = {
  skills: () => SkillCard[];
  skillStore: SkillDetailsStore;
  canEditSkills: boolean;
  renderConnector: (name: string, onClose: () => void, pluginName: string) => ReactNode;
  readComponent: (pluginId: string, path: string) => Promise<{ content: string }>;
};

/** Overview and component details share one navigation history within the plugin. */
export function PluginDetailsDialog(props: { plugin: ImportedPlugin; busy: boolean; access?: PluginDetailsAccess; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [component, setComponent] = useState<ImportedPluginFile | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  useEffect(() => { if (component === null && body.current) body.current.scrollTop = scrollTop.current; }, [component]);
  const name = pluginImportName(props.plugin);
  const skills = props.access?.skills() ?? [];
  const count = props.plugin.files.filter(file => ["skill", "mcp", "agent", "command"].includes(file.objectType)).length;
  const source = props.plugin.pluginId.startsWith("import:chatgpt:") ? "ChatGPT" : props.plugin.pluginId.startsWith("import:claude:") ? "Claude" : null;
  const back = () => setComponent(null);
  const skill = component?.objectType === "skill" ? skills.find(skill => skill.name === pluginFileInstalledName(component)) ?? { name: pluginFileInstalledName(component), path: component.path, description: "" } : null;
  return <>
    <Dialog open={component === null} onOpenChange={open => { if (!open) props.onClose(); }}>
      <DialogContent finalFocus={component ? false : undefined} className="flex max-h-[calc(100dvh-3rem)] min-h-0 flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-3 border-b border-border px-6 py-5 pr-14">
          <div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border"><Package className="size-5 text-muted-foreground" /></span><DialogTitle className="min-w-0 truncate">{name}</DialogTitle>{source ? <span className="ml-auto shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{source}</span> : null}</div>
          {props.plugin.description ? <DialogDescription className="line-clamp-3 leading-relaxed">{props.plugin.description}</DialogDescription> : <DialogDescription className="sr-only">{t("plugin_details.contents")}</DialogDescription>}
        </DialogHeader>
        {count > 5 ? <div className="border-b border-border px-6 py-3"><div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" aria-label={t("plugin_details.search")} placeholder={t("plugin_details.search")} value={query} onChange={event => setQuery(event.currentTarget.value)} /></div></div> : null}
        <div ref={body} role="region" aria-label={t("plugin_details.contents")} className="min-h-0 flex-1 overflow-y-auto px-3 py-4"><ImportedPackageContents plugin={props.plugin} skills={skills} query={query} busy={props.busy} onOpen={props.access ? file => { scrollTop.current = body.current?.scrollTop ?? 0; setComponent(file); } : undefined} /></div>
      </DialogContent>
    </Dialog>
    {component && props.access ? skill ? <SkillDetailsDialog key={component.path} skill={skill} extensions={props.access.skillStore} canEdit={props.access.canEditSkills} busy={props.busy} pluginName={name} onClose={back} /> : component.objectType === "mcp" ? props.access.renderConnector(pluginFileInstalledName(component), back, name) : <PluginDocumentDialog key={component.path} plugin={props.plugin} file={component} read={props.access.readComponent} onBack={back} /> : null}
  </>;
}

function PluginDocumentDialog(props: { plugin: ImportedPlugin; file: ImportedPluginFile; read: PluginDetailsAccess["readComponent"]; onBack: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let stopped = false;
    setContent(null); setError("");
    props.read(props.plugin.pluginId, props.file.path).then(result => { if (!stopped) setContent(result.content); }).catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : t("plugin_details.unavailable")); });
    return () => { stopped = true; };
  }, [props.read, props.plugin.pluginId, props.file.path, revision]);
  return <Dialog open onOpenChange={open => { if (!open) props.onBack(); }}><DialogContent className="flex max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-2xl">
    <DialogHeader className="space-y-3 border-b border-border px-6 py-5 pr-14"><Button variant="ghost" size="sm" className="-ml-2 w-fit max-w-full" onClick={props.onBack}><ArrowLeft className="size-4 shrink-0" /><span className="truncate">{t("plugin_details.back", { name: pluginImportName(props.plugin) })}</span></Button><DialogTitle>{pluginComponentLabel(props.file)}</DialogTitle><DialogDescription>{packageParts([props.file.objectType])}</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{error ? <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>{t("common.refresh")}</Button></div> : content === null ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("common.loading")}</p> : <MarkdownBlock text={content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")} />}</div>
  </DialogContent></Dialog>;
}
