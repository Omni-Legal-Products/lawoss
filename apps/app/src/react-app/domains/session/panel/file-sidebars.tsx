/** @jsxImportSource react */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import type { FileSidebarItem } from "../../../shell/ui-state-store";
import { FILE_SIDEBAR_DRAG_TYPE } from "./file-drop-intent";

/** Keep visited navigation panes mounted so previews, rail switches and closing
 * the navigation column preserve folder expansion, search and scroll position.
 * Unvisited panes do not load their connections or folders.
 */
export function FileSidebars(props: {
  active: FileSidebarItem | null;
  viewerOpen: boolean;
  memory: ReactNode;
  files: ReactNode;
  wiki?: ReactNode;
  onResize?: (width: number) => void;
}) {
  const panelRef = usePanelRef();
  const expandedWidth = useRef(300);
  const [visited, setVisited] = useState<FileSidebarItem[]>([]);
  useLayoutEffect(() => {
    const active = props.active;
    if (active) {
      setVisited((current) => (current.includes(active) ? current : [...current, active]));
    }
    // The group restores a separate layout when the viewer opens or closes.
    // Capture the current width before that layout can overwrite it, then apply
    // it after the group has registered its panels and visibility constraints.
    const width = expandedWidth.current;
    const frame = requestAnimationFrame(() => {
      if (active) panelRef.current?.resize(width);
      else panelRef.current?.collapse();
    });
    return () => cancelAnimationFrame(frame);
  }, [props.active, props.viewerOpen, panelRef]);

  return (
    <>
      <ResizableHandle withHandle className={props.active ? undefined : "hidden"} />
      <ResizablePanel
        id="file-navigation"
        panelRef={panelRef}
        groupResizeBehavior="preserve-pixel-size"
        collapsible={!props.active}
        collapsedSize="0px"
        defaultSize={props.active ? "300px" : "0px"}
        minSize={props.active ? "220px" : "0px"}
        maxSize={props.active ? "40%" : "0px"}
        disabled={!props.active}
        onResize={(size) => {
          if (props.active && size.inPixels > 0) expandedWidth.current = size.inPixels;
          props.onResize?.(size.inPixels);
        }}
        className="min-h-0 overflow-hidden"
      >
        {(["memory", "files", "wiki"] satisfies FileSidebarItem[]).map((kind) => (
          <div key={kind} hidden={props.active !== kind} className="h-full min-h-0" data-file-sidebar={kind}
            // Mark after row/selection handlers have finished replacing drag payloads.
            onDragStart={event => event.dataTransfer.setData(FILE_SIDEBAR_DRAG_TYPE, "")}>
            {props.active === kind || visited.includes(kind) ? props[kind] : null}
          </div>
        ))}
      </ResizablePanel>
    </>
  );
}
