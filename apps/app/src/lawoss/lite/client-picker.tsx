/** @jsxImportSource react */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { t, type Language } from "@/i18n";
import { defaultClientChoice, newMatterLink, rememberClient, type ClientChoice } from "./client-choice";
import { NEW_MATTER_PATH } from "./links";

type Purpose = "new_matter" | "ask";
const TITLE: Record<Purpose, string> = { new_matter: "client_pick_new_matter", ask: "client_pick_ask" };

/**
 * Krátky výber klienta (MČ 16. 10. 2026): predvolený je naposledy vybraný, inak otvorený klient.
 * Potvrdenie si klienta zapamätá; zrušenie nič nespustí.
 */
export function ClientPickerDialog({ open, purpose, choices, activeId, locale, onPick, onClose, loading = false }: {
  open: boolean;
  /** Klienti sa ešte čítajú: dialóg to povie namiesto prázdneho zoznamu. */
  loading?: boolean;
  purpose: Purpose;
  choices: readonly ClientChoice[];
  activeId?: string | null;
  locale: Language;
  onPick: (choice: ClientChoice) => void;
  onClose: () => void;
}) {
  const text = (key: string) => t(`lawoss.lite.${key}`, locale);
  const [selected, setSelected] = useState(() => defaultClientChoice(choices, activeId)?.id ?? "");
  // Predvolený klient len pri otvorení; prekreslenie (nové čítanie, nový zoznam) výber advokáta nemení.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setSelected(defaultClientChoice(choices, activeId)?.id ?? "");
    wasOpen.current = open;
  }, [open, choices, activeId]);
  const labelId = useId();
  const choice = choices.find((c) => c.id === selected);
  const confirm = () => {
    if (!choice) return;
    rememberClient(choice.id);
    onPick(choice);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent data-lawoss-client-picker={purpose}>
        <DialogHeader>
          <DialogTitle id={labelId}>{text(TITLE[purpose])}</DialogTitle>
          <DialogDescription>{text("client_pick_note")}</DialogDescription>
        </DialogHeader>
        {loading && choices.length === 0 ? <p role="status" className="text-sm text-muted-foreground" data-lawoss-client-picker-loading="">{t("lawoss.lite.state_loading", locale)}</p> : null}
        <RadioGroup aria-labelledby={labelId} value={selected} onValueChange={(value) => setSelected(String(value))} className="max-h-72 gap-1 overflow-y-auto">
          {choices.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50" data-lawoss-client-choice={c.id}>
              <RadioGroupItem value={c.id} />
              <span>{c.title}</span>
            </label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{text("client_pick_cancel")}</Button>
          <Button type="button" onClick={confirm} disabled={!choice}>{text("client_pick_continue")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * „+ Nová vec“: v praxi s viacerými klientmi najprv krátky výber, inak rovno formulár (ako doteraz).
 * `clientRoot` = karta konkrétneho klienta, ide sa rovno do neho.
 */
export function NewMatterAction({ className, locale, choices = [], activeId, clientRoot, children }: {
  className?: string;
  locale: Language;
  choices?: readonly ClientChoice[];
  activeId?: string | null;
  clientRoot?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const target = clientRoot ? newMatterLink(clientRoot) : choices.length === 1 ? newMatterLink(choices[0].root) : NEW_MATTER_PATH;
  if (clientRoot || choices.length < 2) {
    return <Link className={className} to={target}>{children}</Link>;
  }
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)} data-lawoss-new-matter-pick="">{children}</button>
    <ClientPickerDialog open={open} purpose="new_matter" choices={choices} activeId={activeId} locale={locale}
      onClose={() => setOpen(false)} onPick={(choice) => { setOpen(false); navigate(newMatterLink(choice.root)); }} />
  </>;
}
