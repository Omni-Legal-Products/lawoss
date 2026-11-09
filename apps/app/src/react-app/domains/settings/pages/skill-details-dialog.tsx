import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import type { SkillCard } from "@/app/types";
import { syncAttachedFilesSection } from "@/app/utils/skill-resources";
import { MarkdownBlock } from "@/components/markdown/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { useOrgPolicyForbids } from "../../connections/org-policy";
import { SkillResourcesPanel, type SkillResourcesStore } from "./skill-resources-panel";
import { pluginImportSkillName } from "./plugin-import-presentation";
import { t } from "@/i18n";

export type SkillDetailsStore = SkillResourcesStore & {
  readSkill: (name: string) => Promise<{ content: string } | null>;
  saveSkill: (input: { name: string; content: string; description?: string }) => void | Promise<void>;
};

/** The same instructions/editor/resource controls serve the library and plugins. */
export function SkillDetailsDialog(props: { skill: SkillCard; extensions: SkillDetailsStore; busy: boolean; canEdit: boolean; onClose: () => void; pluginName?: string; initialEditing?: boolean }) {
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(Boolean(props.initialEditing));
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [revision, setRevision] = useState(0);
  const forbidden = useOrgPolicyForbids("skills.allowCustom");
  const canEdit = props.canEdit && !forbidden;
  const dirty = content !== saved;
  const instructions = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const generatedFooter = instructions.match(/\n+Imported package resources: [^\n]+\. Resolve package-relative paths there\.\r?\n+Component mapping: [^\n]+\.\s*$/)?.[0];
  const technicalDetails = generatedFooter?.includes(` → ${props.skill.name}`) ? generatedFooter : null;
  const visibleInstructions = technicalDetails ? instructions.slice(0, -technicalDetails.length) : instructions;
  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError("");
    props.extensions.readSkill(props.skill.name).then(result => {
      if (stopped) return;
      if (!result) { setError(t("skills.skill_load_failed")); return; }
      setContent(result.content);
      setSaved(result.content);
    }).catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : t("skills.skill_load_failed")); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [props.extensions, props.skill.name, revision]);
  const close = () => { if (saving) return; if (dirty) setDiscard(true); else props.onClose(); };
  const save = async () => {
    if (!canEdit || !dirty || saving || props.busy) return;
    setSaving(true);
    setError("");
    try { await props.extensions.saveSkill({ name: props.skill.name, content, description: props.skill.description }); setSaved(content); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("skills.unknown_error")); }
    finally { setSaving(false); }
  };
  const syncResources = async () => {
    const result = await props.extensions.readSkill(props.skill.name);
    if (!result) return;
    setContent(current => dirty ? syncAttachedFilesSection(current, result.content) : result.content);
    setSaved(result.content);
  };
  return <>
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="flex max-h-[calc(100dvh-3rem)] min-h-0 flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-3xl">
        <DialogHeader className="space-y-3 border-b border-border px-6 py-5 pr-14">
          {props.pluginName ? <Button variant="ghost" size="sm" className="-ml-2 w-fit max-w-full" disabled={saving} onClick={close}><ArrowLeft className="size-4 shrink-0" /><span className="truncate">{t("plugin_details.back", { name: props.pluginName })}</span></Button> : null}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1"><DialogTitle>{pluginImportSkillName(props.skill)}</DialogTitle><DialogDescription className="line-clamp-2">{props.skill.description || t("skills.eyebrow_skill")}</DialogDescription></div>
            {canEdit ? editing ? <Button size="sm" disabled={!dirty || loading || saving || props.busy} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{t("common.save")}</Button> : <Button variant="outline" size="sm" disabled={loading || props.busy || Boolean(error)} onClick={() => setEditing(true)}><Pencil className="size-3.5" />{t("common.edit")}</Button> : null}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{!dirty ? <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>{t("common.refresh")}</Button> : null}</div> : null}
          {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("skills.loading")}</p> : !error || content ? <>
            {editing && canEdit ? <Textarea aria-label={t("plugin_details.instructions")} value={content} onChange={event => setContent(event.currentTarget.value)} disabled={saving || props.busy} spellCheck={false} className="min-h-80 font-mono text-xs leading-relaxed" /> : <>
              <MarkdownBlock text={visibleInstructions} />
              {technicalDetails ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t("mcp.technical_details")}</summary><div className="mt-3 [overflow-wrap:anywhere]"><MarkdownBlock text={technicalDetails.trim()} /></div></details> : null}
            </>}
            <SkillResourcesPanel skillName={props.skill.name} busy={props.busy || saving || !canEdit} extensions={props.extensions} onChanged={() => void syncResources()} />
          </> : null}
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmModal open={discard} title={t("common.unsaved_changes")} message={t("plugin_details.discard_hint")} confirmLabel={t("artifact.discard_changes")} cancelLabel={t("common.cancel")} onCancel={() => setDiscard(false)} onConfirm={props.onClose} />
  </>;
}
