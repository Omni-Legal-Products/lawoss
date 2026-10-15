import { LayoutDashboard, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/** The dashboard's four tiles share the weight and sizing of app navigation icons. */
export function DashboardIcon({ className, ...props }: LucideProps) {
  return <LayoutDashboard aria-hidden="true" strokeWidth={1.5} className={cn("size-4 shrink-0", className)} {...props} />;
}
