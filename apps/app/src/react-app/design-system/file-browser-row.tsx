import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type FileBrowserRowProps = ComponentProps<"button"> & {
  icon: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  muted?: boolean;
};

/** Shared file and folder appearance for right-side browsers. */
export function FileBrowserRow({ icon, leading, trailing, selected = false, muted = false, children, className, ...props }: FileBrowserRowProps) {
  return <button type="button" {...props} className={cn(
    "group flex min-h-9 w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
    selected ? "border-border bg-muted/80" : "hover:border-border/50 hover:bg-muted/60 focus-visible:bg-muted/60",
    className,
  )}>
    {leading}{icon}
    <span className={cn("min-w-0 flex-1 truncate text-[13px]", muted ? "text-muted-foreground" : "text-foreground", selected && "font-medium")}>{children}</span>
    {trailing}
  </button>;
}
