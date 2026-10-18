import type { ReactNode } from "react";
import { Blocks } from "lucide-react";
import { IntegrationLibraryRow } from "./integration-library";

export function SkillLibraryRow(props: { name: string; description: string; source?: ReactNode; busy: boolean; onOpen: () => void; onExport?: () => void; onShare?: () => void; onRemove?: () => void }) {
  return <IntegrationLibraryRow {...props} icon={<span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border"><Blocks className="size-4 text-muted-foreground" /></span>}
    />;
}
