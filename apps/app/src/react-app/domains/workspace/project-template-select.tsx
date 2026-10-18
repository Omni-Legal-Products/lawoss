import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { projectTemplateName, useProjectDefaultsStore } from "./project-defaults-store";

export function ProjectTemplateSelect({ value, onChange, disabled }: {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const templates = useProjectDefaultsStore((state) => state.templates);
  const selected = templates.find((template) => template.id === value);
  return <Select value={selected?.id ?? ""} onValueChange={(id) => onChange(id || null)} disabled={disabled}>
    <SelectTrigger className="w-full" aria-label={t("projects.templates.template")}>
      <SelectValue>{selected ? projectTemplateName(selected) : t("projects.templates.none")}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="">{t("projects.templates.none")}</SelectItem>
      {templates.map((template) => <SelectItem key={template.id} value={template.id}>{projectTemplateName(template)}</SelectItem>)}
    </SelectContent>
  </Select>;
}
