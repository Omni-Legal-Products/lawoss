import { Boxes, Cable, LayoutGrid, Store } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { resolveBrandIconSrc } from "@/react-app/design-system/extension-icon-src";

const sections = [
  { id: "available", label: "lawoss.integrations.available", Icon: LayoutGrid },
  { id: "installed", label: "catalog.installed", Icon: Cable },
  { id: "marketplace", label: "LAWOSS Marketplace", Icon: Store },
  { id: "google", label: "Google Workspace", Icon: null },
  { id: "office", label: "lawoss.integrations.office_tools", Icon: Boxes },
] as const;
export type IntegrationSection = typeof sections[number]["id"];

export function integrationSection(value: string | null, marketplace: boolean, office: boolean, initialMarketplace: boolean): IntegrationSection {
  const selected = sections.find(section => section.id === value)?.id;
  if ((selected === "google" || selected === "marketplace") && !marketplace) return "available";
  if (selected === "office" && !office) return "available";
  return selected ?? (initialMarketplace && marketplace ? "marketplace" : "available");
}

export function GoogleMark() {
  return <img aria-hidden="true" alt="" src={resolveBrandIconSrc(undefined, "google")} className="size-4 shrink-0 object-contain" />;
}

export function IntegrationNavigation({ active, installed, marketplace, office, onChange }: {
  active: IntegrationSection; installed: number; marketplace: boolean; office: boolean; onChange: (id: IntegrationSection) => void;
}) {
  return <nav aria-label={t("extensions.eyebrow_integrations")} className="flex flex-wrap items-center gap-1 border-b border-border pb-3">
    {sections.filter(({ id }) => id === "office" ? office : id === "google" || id === "marketplace" ? marketplace : true).map(({ id, label, Icon }) =>
      <Button key={id} size="sm" variant={active === id ? "secondary" : "ghost"} aria-current={active === id ? "page" : undefined} onClick={() => onChange(id)}>
        {Icon ? <Icon aria-hidden className="size-4" /> : <GoogleMark />}
        {id === "marketplace" || id === "google" ? label : t(label)}
        {id === "installed" ? <span className="rounded-md border border-border px-1.5 text-[10px] tabular-nums">{installed}</span> : null}
      </Button>
    )}
  </nav>;
}
