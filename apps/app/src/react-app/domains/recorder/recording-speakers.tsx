import { useEffect, useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import type { AudioTranscriptEdit } from "@legalwork/types/audio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";

export const SPEAKER_COLORS = ["var(--lw-file-word)", "var(--lw-file-image)", "var(--lw-file-sheet)", "var(--lw-file-slides)"];
export type TranscriptSpeaker = { id: number; name: string; segmentCount: number };
type Edit = (edit: AudioTranscriptEdit) => Promise<boolean>;

export function SpeakerAssignment({ speaker, speakers, segmentIds, disabled, compact, edit }: {
  speaker: number | null; speakers: TranscriptSpeaker[]; segmentIds: string[]; disabled: boolean; compact?: boolean; edit: Edit;
}) {
  const name = speakers.find(item => item.id === speaker)?.name ?? t("recorder.speaker_unknown");
  return <DropdownMenu>
    <DropdownMenuTrigger render={<button type="button" className={compact ? "lw-transcript-segment-menu" : "lw-transcript-speaker-button"} disabled={disabled}
      style={speaker === null ? undefined : { color: SPEAKER_COLORS[speaker % SPEAKER_COLORS.length] }}
      aria-label={t("recorder.speaker_assign_label", { name })} title={t("recorder.speaker_assign")} />}>
      {compact ? null : name}<ChevronDown className="size-3" />
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("recorder.speaker_assign")}</DropdownMenuLabel>
        {[{ id: null, name: t("recorder.speaker_unknown") }, ...speakers].map(item => <DropdownMenuItem key={item.id ?? "unknown"}
          onClick={() => void edit({ type: "assign-segments", segmentIds, speaker: item.id })}>
          <span className="flex-1">{item.name}</span>{item.id === speaker ? <Check /> : null}
        </DropdownMenuItem>)}
      </DropdownMenuGroup>
      {speaker !== null ? <>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("recorder.speaker_reassign_all")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {[{ id: null, name: t("recorder.speaker_unknown") }, ...speakers.filter(item => item.id !== speaker)].map(item =>
              <DropdownMenuItem key={item.id ?? "unknown"} onClick={() => void edit({ type: "reassign-speaker", from: speaker, to: item.id })}>{item.name}</DropdownMenuItem>)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function SpeakerName({ speaker, disabled, edit, onRemove }: { speaker: TranscriptSpeaker; disabled: boolean; edit: Edit; onRemove: () => void }) {
  const [name, setName] = useState(speaker.name);
  const [editing, setEditing] = useState(false);
  useEffect(() => setName(speaker.name), [speaker.name]);
  const cancel = () => { setName(speaker.name); setEditing(false); };
  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || disabled) return;
    if (trimmed === speaker.name || await edit({ type: "rename-speaker", speaker: speaker.id, name: trimmed })) setEditing(false);
  };
  const renameLabel = t("recorder.speaker_rename", { name: speaker.name });
  const removeLabel = t("recorder.speaker_remove_label", { name: speaker.name });
  return <div className="lw-transcript-person" role="listitem">
    <span className="lw-transcript-avatar" aria-hidden="true" style={{ color: SPEAKER_COLORS[speaker.id % SPEAKER_COLORS.length] }}>{speaker.name.slice(0, 1).toLocaleUpperCase()}</span>
    {editing ? <form className="lw-transcript-name-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <Input autoFocus value={name} maxLength={120} disabled={disabled} aria-label={renameLabel}
        onFocus={event => event.currentTarget.select()} onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }} />
      <Button type="submit" variant="ghost" size="icon-xs" disabled={disabled || !name.trim()} aria-label={t("common.save")} title={t("common.save")}><Check /></Button>
      <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} onClick={cancel} aria-label={t("common.cancel")} title={t("common.cancel")}><X /></Button>
    </form> : <>
      <button className="lw-transcript-person-name" disabled={disabled} onClick={() => setEditing(true)} aria-label={renameLabel} title={renameLabel}>
        <span>{speaker.name}</span>
        <small>{t(speaker.segmentCount === 0 ? "recorder.speaker_no_segments" : speaker.segmentCount === 1 ? "recorder.speaker_one_segment" : "recorder.speaker_segments", { count: speaker.segmentCount })}</small>
      </button>
      <div className="lw-transcript-person-actions">
        <Button variant="ghost" size="icon-xs" disabled={disabled} onClick={() => setEditing(true)} aria-label={renameLabel} title={renameLabel}><Pencil /></Button>
        <Button variant="ghost" size="icon-xs" className="lw-transcript-remove-speaker" disabled={disabled} onClick={onRemove} aria-label={removeLabel} title={removeLabel}><Trash2 /></Button>
      </div>
    </>}
  </div>;
}

export function RecordingSpeakers({ speakers, disabled, live, edit }: { speakers: TranscriptSpeaker[]; disabled: boolean; live: boolean; edit: Edit }) {
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<TranscriptSpeaker | null>(null);
  const [reassignTo, setReassignTo] = useState("unassigned");
  return <>
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("recorder.speaker_settings")} title={t("recorder.speaker_settings")} />}>
        <Settings />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="lw-transcript-people-popover">
    <div className="lw-transcript-people-card">
      <header><PopoverTitle>{t("recorder.speaker_people")}</PopoverTitle><span className="lw-transcript-people-count">{speakers.length}</span></header>
      {live ? <p>{t("recorder.speaker_edit_after_recording")}</p> : null}
      <div className="lw-transcript-people-list" role="list">
        {speakers.map(speaker => <SpeakerName key={speaker.id} speaker={speaker} disabled={disabled} edit={edit}
          onRemove={() => { setReassignTo("unassigned"); setRemoving(speaker); }} />)}
      </div>
      <form className="lw-transcript-add-speaker" onSubmit={event => {
        event.preventDefault();
        if (!name.trim() || disabled) return;
        void edit({ type: "add-speaker", name }).then(saved => { if (saved) setName(""); });
      }}>
        <Input value={name} maxLength={120} disabled={disabled} placeholder={t("recorder.speaker_add")} aria-label={t("recorder.speaker_add")} onChange={event => setName(event.target.value)} />
        <Button type="submit" variant="ghost" size="icon-xs" disabled={disabled || !name.trim()} aria-label={t("recorder.speaker_add")} title={t("recorder.speaker_add")}><Plus /></Button>
      </form>
    </div>
      </PopoverContent>
    </Popover>
    <Dialog open={removing !== null} onOpenChange={open => { if (!open && !disabled) setRemoving(null); }}>
      <DialogContent showCloseButton={!disabled}>
        <DialogHeader>
          <DialogTitle>{t("recorder.speaker_remove_title", { name: removing?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t(removing?.segmentCount ? "recorder.speaker_remove_description" : "recorder.speaker_remove_unused")}</DialogDescription>
        </DialogHeader>
        {removing && removing.segmentCount > 0 ? <div className="grid gap-2">
          <label id="speaker-reassign-label" className="text-sm font-medium">{t("recorder.speaker_remove_assign")}</label>
          <Select value={reassignTo} onValueChange={value => { if (value !== null) setReassignTo(value); }} disabled={disabled}
            items={[{ value: "unassigned", label: t("recorder.speaker_unknown") }, ...speakers.filter(speaker => speaker.id !== removing.id).map(speaker => ({ value: String(speaker.id), label: speaker.name }))]}>
            <SelectTrigger className="w-full" aria-labelledby="speaker-reassign-label"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">{t("recorder.speaker_unknown")}</SelectItem>
              {speakers.filter(speaker => speaker.id !== removing.id).map(speaker => <SelectItem key={speaker.id} value={String(speaker.id)}>{speaker.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div> : null}
        <DialogFooter>
          <Button variant="ghost" disabled={disabled} onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
          <Button variant="destructive" disabled={disabled || !removing} onClick={() => {
            if (removing) void edit({ type: "remove-speaker", speaker: removing.id, reassignTo: reassignTo === "unassigned" ? null : Number(reassignTo) }).then(saved => { if (saved) setRemoving(null); });
          }}><Trash2 />{t("recorder.speaker_remove")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
