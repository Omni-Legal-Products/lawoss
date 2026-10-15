import { useId } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { graphConditionNeedsValue, graphPropertyOperators, validGraphCondition, type GraphPropertyCondition, type GraphPropertyField, type GraphPropertyOperator } from "./wiki-graph-properties";

function operatorLabel(operator: GraphPropertyOperator, kind: GraphPropertyCondition["kind"]) {
  if (operator === "eq" && kind === "date") return t("project_filters.on");
  return { eq: t("project_filters.is"), ne: t("project_filters.is_not"), contains: t("project_filters.contains"),
    exists: t("wiki.graph_property_exists"), missing: t("wiki.graph_property_missing"),
    gt: t("project_filters.gt"), gte: t("project_filters.gte"), lt: t("project_filters.lt"), lte: t("project_filters.lte"),
    before: t("project_filters.before"), after: t("project_filters.after") }[operator];
}

export function WikiGraphPropertyFilters({ fields, conditions, mode, onChange, onModeChange }: {
  fields: GraphPropertyField[]; conditions: GraphPropertyCondition[]; mode: "all" | "any";
  onChange: (conditions: GraphPropertyCondition[]) => void; onModeChange: (mode: "all" | "any") => void;
}) {
  return <section className="space-y-2 border-y py-3" aria-label={t("wiki.graph_property_filters")}>
    <p className="font-medium">{t("wiki.graph_property_filters")}</p>
    {conditions.length > 1 && <Select value={mode} onValueChange={value => { if (value === "all" || value === "any") onModeChange(value); }}>
      <SelectTrigger size="sm" className="w-full text-xs" aria-label={t("project_filters.combine")}><SelectValue>{t(mode === "all" ? "project_filters.match_all" : "project_filters.match_any")}</SelectValue></SelectTrigger>
      <SelectContent><SelectItem value="all">{t("project_filters.match_all")}</SelectItem><SelectItem value="any">{t("project_filters.match_any")}</SelectItem></SelectContent>
    </Select>}
    {conditions.map((condition, index) => <Condition key={index} fields={fields} condition={condition}
      onChange={next => onChange(conditions.map((item, position) => position === index ? next : item))}
      onRemove={() => onChange(conditions.filter((_, position) => position !== index))} />)}
    <Button variant="ghost" size="sm" className="w-full justify-start text-xs" disabled={!fields.length} onClick={() => {
      const field = fields[0];
      if (field) onChange([...conditions, { property: field.key, kind: field.kind, operator: "exists", value: "" }]);
    }}><Plus className="size-3.5" />{t("wiki.graph_property_add")}</Button>
    {!fields.length && <p className="text-[11px] text-muted-foreground">{t("wiki.graph_property_none")}</p>}
  </section>;
}

function Condition({ fields, condition, onChange, onRemove }: {
  fields: GraphPropertyField[]; condition: GraphPropertyCondition; onChange: (condition: GraphPropertyCondition) => void; onRemove: () => void;
}) {
  const valuesId = useId();
  const field = fields.find(field => field.key === condition.property);
  return <div className="space-y-2 rounded-lg border bg-background/50 p-2">
    <div className="flex min-w-0 items-center gap-1">
      <Select value={condition.property} onValueChange={key => {
        const next = fields.find(field => field.key === key);
        if (next) onChange({ property: next.key, kind: next.kind, operator: "exists", value: "" });
      }}>
        <SelectTrigger size="sm" className="min-w-0 flex-1 text-xs" aria-label={t("wiki.property_name")}><SelectValue>{condition.property}</SelectValue></SelectTrigger>
        <SelectContent>{!field && <SelectItem value={condition.property}>{condition.property}</SelectItem>}{fields.map(field => <SelectItem key={field.key} value={field.key}>{field.key}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="icon-xs" variant="ghost" aria-label={t("project_filters.remove", { name: condition.property })} onClick={onRemove}><X className="size-3.5" /></Button>
    </div>
    <Select value={condition.operator} onValueChange={value => {
      const operator = graphPropertyOperators(condition.kind).find(operator => operator === value);
      if (operator) onChange({ ...condition, operator, value: condition.kind === "boolean" && !condition.value ? "true" : condition.value });
    }}>
      <SelectTrigger size="sm" className="w-full text-xs" aria-label={t("project_filters.operator")}><SelectValue>{operatorLabel(condition.operator, condition.kind)}</SelectValue></SelectTrigger>
      <SelectContent>{graphPropertyOperators(condition.kind).map(operator => <SelectItem key={operator} value={operator}>{operatorLabel(operator, condition.kind)}</SelectItem>)}</SelectContent>
    </Select>
    {graphConditionNeedsValue(condition) && (condition.kind === "boolean" ? <Select value={condition.value} onValueChange={value => { if (value === "true" || value === "false") onChange({ ...condition, value }); }}>
      <SelectTrigger size="sm" className="w-full text-xs" aria-label={t("project_filters.value")}><SelectValue>{t(condition.value === "true" ? "wiki.graph_condition_true" : "wiki.graph_condition_false")}</SelectValue></SelectTrigger>
      <SelectContent><SelectItem value="true">{t("wiki.graph_condition_true")}</SelectItem><SelectItem value="false">{t("wiki.graph_condition_false")}</SelectItem></SelectContent>
    </Select> : <>
      <Input className="h-8 text-xs" type={condition.kind === "number" ? "number" : condition.kind === "date" ? "date" : "text"} step={condition.kind === "number" ? "any" : undefined}
        list={condition.kind === "text" ? valuesId : undefined} value={condition.value} aria-label={t("project_filters.value")} aria-invalid={!validGraphCondition(condition)} placeholder={t("project_filters.value")}
        onChange={event => onChange({ ...condition, value: event.target.value })} />
      {condition.kind === "text" && <datalist id={valuesId}>{field?.options.map(value => <option key={value} value={value} />)}</datalist>}
    </>)}
    {!validGraphCondition(condition) && <p className="text-[11px] text-muted-foreground">{t("wiki.graph_condition_invalid")}</p>}
  </div>;
}
