/** @jsxImportSource react */
import { AlertTriangle } from "lucide-react";

/**
 * Rozhodnutie MČ 31. 10. 2026: karta „Pristúpiť k externému priečinku?“ pri priečinku iného klienta (aj v režime YOLO)
 * výrazne varuje: červený rámček s ikonou, nie len riadok textu. Text skladá `other-client-folder.ts`.
 */
export function OtherClientWarning(props: { text: string | null }) {
  if (!props.text) return null;
  return (
    <div role="alert" data-lawoss-other-client="" className="mt-2 flex items-start gap-2 rounded-lg border border-red-7/30 bg-red-3/40 px-3 py-2 text-[12.5px] font-semibold leading-5 text-red-11">
      <AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <span>{props.text}</span>
    </div>
  );
}
