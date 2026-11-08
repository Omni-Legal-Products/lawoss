/** @jsxImportSource react */
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { useRecorderStore } from "./recorder-store";

export function cloudModelName(region: "EU" | "US") {
  return t(region === "EU" ? "recorder.transcription_cloud_eu" : "recorder.transcription_cloud_us");
}

export function CloudModelList() {
  const store = useRecorderStore();
  const busy = Boolean(store.recording || store.starting || store.finalizing || store.importing);
  return (store.bootstrap?.cloud?.models ?? []).filter(model => model.enabled && model.available).map(model => {
    const selected = store.transcriptionSource === "cloud" && store.cloudModelId === model.model;
    return (
      <div key={model.model} className={cn(
        "rounded-2xl border bg-surface px-3.5 py-3 shadow-xs transition-colors",
        selected ? "border-brand ring-1 ring-brand/20" : "border-subtle",
      )}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{cloudModelName(model.region)}</span>
              {selected ? <Badge variant="outline" className="gap-1 text-2xs text-brand">
                <Check className="size-3" />{t("recorder.model_selected")}
              </Badge> : null}
            </div>
            <p className="mt-0.5 text-xs text-subtext">
              {t("recorder.transcription_cloud_tagline")}
            </p>
          </div>
          {!selected ? <Button
            variant="outline" size="sm" disabled={busy}
            onClick={() => store.setTranscriptionSource("cloud", model.model)}
          >{t("recorder.model_use")}</Button> : null}
        </div>
      </div>
    );
  });
}
