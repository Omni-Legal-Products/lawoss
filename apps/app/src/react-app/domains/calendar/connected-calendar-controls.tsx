import { CalendarDays, ChevronDown, ExternalLink, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { openDesktopUrl } from "@/app/lib/desktop";
import { currentLocale, t } from "@/i18n";
import { calendarDisplayColor } from "./calendar-colors";
import { cn } from "@/lib/utils";
import type { CalendarDisplayOccurrence, ConnectedCalendar } from "./connected-calendars";

export function ConnectedCalendarControls({ calendars, hidden, loading, disabled, onVisible }: {
  calendars: ConnectedCalendar[]; hidden: string[]; loading: boolean; disabled: boolean; onVisible: (key: string, visible: boolean) => void;
}) {
  const visibleCount = calendars.filter(calendar => !hidden.includes(calendar.key)).length;
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className={cn("h-7 min-w-0 max-w-full gap-1.5 rounded-lg border-transparent bg-transparent px-2 text-xs font-normal text-foreground hover:bg-muted/60", visibleCount < calendars.length && "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15")} disabled={disabled} />}>
      {loading ? <Loader2 aria-hidden className="size-3.5 animate-spin text-muted-foreground" /> : <CalendarDays aria-hidden className="size-3.5 text-muted-foreground" />}
      <span className="min-w-0 truncate">{t("calendar.connected_calendars")}</span>{calendars.length > 0 && <span className="text-muted-foreground">{visibleCount}/{calendars.length}</span>}
      <ChevronDown aria-hidden className="size-3 text-muted-foreground" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
      {!calendars.length && <p className="px-3 py-2 text-sm text-muted-foreground">{t(loading ? "calendar.loading" : "calendar.connected_empty")}</p>}
      {calendars.map(calendar => {
        const color = calendarDisplayColor(calendar.key, calendar.color);
        return <DropdownMenuCheckboxItem key={calendar.key} checked={!hidden.includes(calendar.key)} closeOnClick={false} onCheckedChange={visible => onVisible(calendar.key, visible)}>
          <span aria-hidden style={color.style} className={cn("size-2 shrink-0 rounded-full bg-current ring-1 ring-inset ring-border/50", color.marker)} />
          <span className="min-w-0 flex-1 truncate" title={calendar.name}>{calendar.name || calendar.providerName}</span>
          <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{calendar.providerName}</span>
        </DropdownMenuCheckboxItem>;
      })}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function ConnectedCalendarEventDialog({ item, onClose }: { item: CalendarDisplayOccurrence; onClose: () => void }) {
  const details = item.connectedEvent;
  if (!details) return null;
  const format = (value: string) => item.allDay
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(currentLocale(), { dateStyle: "long" })
    : new Date(value).toLocaleString(currentLocale(), { dateStyle: "long", timeStyle: "short", timeZone: item.timeZone });
  const lastDay = item.allDay && item.end ? new Date(`${item.end}T12:00:00`) : null;
  if (lastDay) lastDay.setDate(lastDay.getDate() - 1);
  const end = lastDay ? `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}` : item.end;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="grid-cols-1 sm:max-w-lg">
      <DialogHeader><DialogTitle>{item.title || t("calendar.event")}</DialogTitle><DialogDescription>{details.calendar.providerName} · {details.calendar.name}</DialogDescription></DialogHeader>
      <div className="max-h-[50vh] space-y-4 overflow-y-auto text-sm">
        <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{format(item.start)}{end && end !== item.start ? ` – ${format(end)}` : ""}{item.allDay && <span className="block text-xs text-muted-foreground">{t("calendar.all_day")}</span>}</span></p>
        {details.location && <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="whitespace-pre-wrap break-words">{details.location}</span></p>}
        {details.description && <p className="whitespace-pre-wrap break-words text-muted-foreground">{details.description}</p>}
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>{t("common.close")}</Button>{details.webUrl && <Button onClick={() => { if (details.webUrl) void openDesktopUrl(details.webUrl); }}><ExternalLink />{t("calendar.open_in_provider", { provider: details.calendar.providerName })}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
