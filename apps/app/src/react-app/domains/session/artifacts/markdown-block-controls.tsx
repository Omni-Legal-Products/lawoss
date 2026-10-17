import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { $createParagraphNode, $getNearestNodeFromDOMNode, $getNodeByKey, $getSelection, $isElementNode, $isRangeSelection, COMMAND_PRIORITY_HIGH, FORMAT_TEXT_COMMAND, HISTORY_PUSH_TAG, KEY_DOWN_COMMAND, type LexicalEditor, type TextFormatType } from "lexical";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { activeEditor$, addComposerChild$, convertSelectionToNode$, applyListType$, insertCodeBlock$, insertTable$, insertThematicBreak$, openLinkEditDialog$, openNewImageDialog$, readOnly$, realmPlugin, rootEditor$, useCellValues, usePublisher, viewMode$ } from "@mdxeditor/editor";
import { ArrowDown, ArrowUp, Bold, CheckSquare, Code, CodeXml, GripVertical, Heading1, Heading2, Heading3, Image, Italic, Link, List, ListOrdered, Minus, Plus, Quote, Strikethrough, Table, Text, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { $deleteDocumentBlock, $documentBlock, $documentBlocks, $dropDocumentBlock, $inlineLinkQuery, $moveDocumentBlock, $removeInlineLinkQuery, $selectedDocumentBlock, $slashQuery, type InlineLinkQuery } from "./markdown-block-model";

type BlockPosition = { key: string; left: number; top: number; right: number; bottom: number };
type SlashState = { key: string; query: string; left: number; top: number; inline?: InlineLinkQuery };
type SelectionPosition = { left: number; top: number; formats: TextFormatType[] };
type BlockDrag = { key: string; pointerId: number; x: number; y: number; moved: boolean };

function position(editor: LexicalEditor, key: string): BlockPosition | null {
  const element = editor.getElementByKey(key);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { key, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function slashPosition(editor: LexicalEditor, query: { key: string; inline?: InlineLinkQuery }) {
  const selection = window.getSelection();
  const caret = query.inline && selection?.rangeCount && editor.getRootElement()?.contains(selection.anchorNode)
    ? selection.getRangeAt(0).getBoundingClientRect() : null;
  const rect = caret?.height ? caret : position(editor, query.key);
  return rect ? { left: rect.left, top: rect.bottom + 6 } : null;
}

function MarkdownBlockControls() {
  const [rootEditor, activeEditor, readOnly, mode] = useCellValues(rootEditor$, activeEditor$, readOnly$, viewMode$);
  const applyListType = usePublisher(applyListType$);
  const insertTable = usePublisher(insertTable$);
  const insertCode = usePublisher(insertCodeBlock$);
  const insertRule = usePublisher(insertThematicBreak$);
  const convertBlock = usePublisher(convertSelectionToNode$);
  const editLink = usePublisher(openLinkEditDialog$);
  const insertImage = usePublisher(openNewImageDialog$);
  const [hover, setHover] = useState<BlockPosition | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [selection, setSelection] = useState<SelectionPosition | null>(null);
  const [drop, setDrop] = useState<{ block: BlockPosition; after: boolean } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const dragging = useRef<BlockDrag | null>(null);
  const suppressClick = useRef(false);
  const dismissedSlash = useRef<string | null>(null);
  const latestHover = useRef(hover);
  latestHover.current = hover;
  const insertMenu = useRef<HTMLDivElement>(null);
  const enabled = Boolean(rootEditor && !readOnly && mode === "rich-text");
  const commandEditor = activeEditor ?? rootEditor;

  const commands = [
    { id: "paragraph", label: t("markdown.toolbar.blockTypes.paragraph"), keywords: "text paragraph absatz", icon: Text },
    { id: "h1", label: t("markdown.toolbar.blockTypes.heading", { level: "1" }), keywords: "heading title überschrift", icon: Heading1 },
    { id: "h2", label: t("markdown.toolbar.blockTypes.heading", { level: "2" }), keywords: "heading title überschrift", icon: Heading2 },
    { id: "h3", label: t("markdown.toolbar.blockTypes.heading", { level: "3" }), keywords: "heading title überschrift", icon: Heading3 },
    { id: "bullet", label: t("markdown.toolbar.bulletedList"), keywords: "bullet list liste", icon: List },
    { id: "number", label: t("markdown.toolbar.numberedList"), keywords: "number ordered list liste", icon: ListOrdered },
    { id: "check", label: t("markdown.toolbar.checkList"), keywords: "task todo checklist aufgabe", icon: CheckSquare },
    { id: "quote", label: t("markdown.toolbar.blockTypes.quote"), keywords: "quote citation zitat", icon: Quote },
    { id: "table", label: t("markdown.toolbar.table"), keywords: "table grid tabelle", icon: Table },
    { id: "code", label: t("markdown.toolbar.codeBlock"), keywords: "code source quelltext", icon: CodeXml },
    { id: "image", label: t("markdown.toolbar.image"), keywords: "image picture bild foto", icon: Image },
    { id: "link", label: t("markdown.toolbar.link"), keywords: "link page file attachment seite datei anhang", icon: Link },
    { id: "rule", label: t("markdown.toolbar.thematicBreak"), keywords: "divider line linie trennlinie", icon: Minus },
  ];
  const matches = commands.filter(command => (!slash?.inline || command.id === "link") && `${command.label} ${command.keywords}`.toLocaleLowerCase().includes(slash?.query.toLocaleLowerCase() ?? ""));
  const latestMatches = useRef(matches);
  latestMatches.current = matches;
  const selectedRef = useRef(selectedCommand);
  selectedRef.current = selectedCommand;

  const insert = useCallback((id: string) => {
    const current = slashRef.current;
    if (!commandEditor || !current) return;
    let consumed = false;
    commandEditor.update(() => {
      if (current.inline) { consumed = $removeInlineLinkQuery(current.inline); return; }
      const block = $getNodeByKey(current.key);
      if (!$isElementNode(block) || block.getType() !== "paragraph" || !/^\/[^\n/]{0,40}$/.test(block.getTextContent())) return;
      block.clear();
      block.selectStart();
      consumed = true;
    }, { discrete: true });
    if (!consumed) return;
    setSlash(null);
    dismissedSlash.current = null;
    // Focus commits the new caret. Opening sooner lets that selection update close the dialog.
    if (id === "link") { commandEditor.focus(() => editLink()); return; }
    commandEditor.focus();
    if (id === "paragraph") convertBlock($createParagraphNode);
    else if (id === "h1" || id === "h2" || id === "h3") convertBlock(() => $createHeadingNode(id));
    else if (id === "quote") convertBlock($createQuoteNode);
    else if (id === "table") insertTable({ rows: 3, columns: 3 });
    else if (id === "code") insertCode({ language: "txt", code: "" });
    else if (id === "rule") insertRule();
    else if (id === "image") insertImage();
    else if (id === "bullet" || id === "number" || id === "check") applyListType(id);
  }, [commandEditor, convertBlock, insertTable, insertCode, insertRule, insertImage, applyListType, editLink]);
  const insertRef = useRef(insert);
  insertRef.current = insert;

  useEffect(() => { setSelectedCommand(0); }, [slash?.query]);
  useEffect(() => { insertMenu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [selectedCommand]);
  useEffect(() => {
    if (!rootEditor || !commandEditor || !enabled) { setHover(null); setSlash(null); setSelection(null); return; }
    return commandEditor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        if (latestHover.current) setHover(position(rootEditor, latestHover.current.key));
        const block = commandEditor === rootEditor ? $slashQuery() : null;
        const inline = block ? null : $inlineLinkQuery();
        const query = block ? { ...block, inline: undefined } : inline ? { ...inline, inline } : null;
        const identity = query ? `${query.key}:${query.query}:${query.inline?.start ?? "block"}` : null;
        if (!query || dismissedSlash.current === identity) { setSlash(null); return; }
        dismissedSlash.current = null;
        const rect = slashPosition(commandEditor, query);
        if (rect) setSlash({ ...query, ...rect });
      });
    });
  }, [rootEditor, commandEditor, enabled]);

  useEffect(() => {
    if (!commandEditor || !enabled) return;
    return commandEditor.registerCommand(KEY_DOWN_COMMAND, event => {
      if (event.isComposing) return false;
      if (commandEditor === rootEditor && event.altKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const block = $selectedDocumentBlock();
        if (!block) return false;
        event.preventDefault();
        $moveDocumentBlock(block.getKey(), event.key === "ArrowUp" ? "up" : "down");
        return true;
      }
      const current = slashRef.current;
      if (!current) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        dismissedSlash.current = `${current.key}:${current.query}:${current.inline?.start ?? "block"}`;
        setSlash(null);
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const count = latestMatches.current.length;
        setSelectedCommand(index => count ? (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count : 0);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const command = latestMatches.current[selectedRef.current];
        if (!command) return false;
        event.preventDefault();
        queueMicrotask(() => insertRef.current(command.id));
        return true;
      }
      return false;
    }, COMMAND_PRIORITY_HIGH);
  }, [rootEditor, commandEditor, enabled]);

  useEffect(() => {
    if (!rootEditor || !enabled) return;
    const root = rootEditor.getRootElement();
    const shell = root?.closest(".lw-markdown-editor");
    if (!root || !shell) return;
    let frame = 0;
    const pointer = (event: PointerEvent) => {
      const drag = dragging.current;
      if (drag) {
        if (event.pointerId !== drag.pointerId) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
        drag.moved = true;
        suppressClick.current = true;
        event.preventDefault();
        setDrop(dropTarget(event.clientX, event.clientY));
        return;
      }
      if (menuOpen || !(event.target instanceof Element)) return;
      if (event.target.closest("[data-markdown-block-ui]")) return;
      if (!shell.contains(event.target)) { setHover(null); return; }
      const target = event.target;
      const directKey = root.contains(target) && target !== root ? rootEditor.getEditorState().read(() => $documentBlock($getNearestNodeFromDOMNode(target))?.getKey(), { editor: rootEditor }) : null;
      let found = directKey ? position(rootEditor, directKey) : null;
      if (!found) {
        const candidates = rootEditor.getEditorState().read(() => $documentBlocks().map(node => node.getKey()));
        for (const key of candidates) {
          const rect = position(rootEditor, key);
          if (rect && event.clientY >= rect.top - 5 && event.clientY <= rect.bottom + 5) { found = rect; break; }
        }
      }
      setHover(found ?? null);
    };
    const geometry = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = latestHover.current;
        if (current) setHover(position(rootEditor, current.key));
        const currentSlash = slashRef.current;
        if (currentSlash && commandEditor) {
          const rect = slashPosition(commandEditor, currentSlash);
          if (rect) setSlash({ ...currentSlash, ...rect });
        }
      });
    };
    const dropTarget = (x: number, y: number) => {
      const bounds = shell.getBoundingClientRect();
      if (x < bounds.left - 53 || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
      const blocks = rootEditor.getEditorState().read(() => $documentBlocks().map(node => node.getKey()));
      const rects = blocks.map(key => position(rootEditor, key)).filter(rect => rect !== null);
      const target = rects.find(rect => y < rect.bottom) ?? rects.at(-1);
      return target ? { block: target, after: y > (target.top + target.bottom) / 2 } : null;
    };
    const cancelDrag = () => { dragging.current = null; setDrop(null); };
    const dropBlock = (event: PointerEvent) => {
      const drag = dragging.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.moved) {
        event.preventDefault();
        const target = dropTarget(event.clientX, event.clientY);
        if (target) rootEditor.update(() => { $dropDocumentBlock(drag.key, target.block.key, target.after); }, { tag: HISTORY_PUSH_TAG });
      }
      cancelDrag();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancelDrag(); };
    document.addEventListener("pointerup", dropBlock);
    document.addEventListener("pointercancel", cancelDrag);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", cancelDrag);
    document.addEventListener("pointermove", pointer);
    window.addEventListener("scroll", geometry, true);
    window.addEventListener("resize", geometry);
    return () => {
      cancelAnimationFrame(frame);
      dragging.current = null;
      document.removeEventListener("pointerup", dropBlock);
      document.removeEventListener("pointercancel", cancelDrag);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancelDrag);
      document.removeEventListener("pointermove", pointer);
      window.removeEventListener("scroll", geometry, true);
      window.removeEventListener("resize", geometry);
    };
  }, [rootEditor, commandEditor, enabled, menuOpen]);

  useEffect(() => {
    if (!activeEditor || !rootEditor || !enabled) return;
    const update = () => {
      const domSelection = window.getSelection();
      const root = rootEditor.getRootElement();
      if (!domSelection?.rangeCount || domSelection.isCollapsed || !root?.contains(domSelection.anchorNode)) { setSelection(null); return; }
      const rect = domSelection.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) { setSelection(null); return; }
      activeEditor.getEditorState().read(() => {
        const current = $getSelection();
        if (!$isRangeSelection(current) || current.isCollapsed()) { setSelection(null); return; }
        const formats: TextFormatType[] = ["bold", "italic", "strikethrough", "code"];
        setSelection({ left: (rect.left + rect.right) / 2, top: rect.top - 10, formats: formats.filter(format => current.hasFormat(format)) });
      });
    };
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, true);
    const dispose = activeEditor.registerUpdateListener(update);
    return () => { document.removeEventListener("selectionchange", update); window.removeEventListener("scroll", update, true); dispose(); };
  }, [activeEditor, rootEditor, enabled]);

  if (!enabled || !rootEditor) return null;
  const format = (value: TextFormatType) => activeEditor?.dispatchCommand(FORMAT_TEXT_COMMAND, value);
  const move = (direction: "up" | "down") => {
    if (!hover) return;
    rootEditor.update(() => { $moveDocumentBlock(hover.key, direction); });
    setMenuOpen(false);
  };
  const addBelow = () => {
    if (!hover) return;
    rootEditor.update(() => {
      const block = $getNodeByKey(hover.key);
      if (!block) return;
      const next = $createParagraphNode();
      block.insertAfter(next);
      next.selectStart();
      const current = $getSelection();
      if ($isRangeSelection(current)) current.insertText("/");
    });
    rootEditor.focus();
  };
  return createPortal(<>
    {hover && !slash && <div className="lw-block-handle" data-markdown-block-ui style={{ left: Math.max(8, hover.left - 53), top: hover.top + 1 }}>
      <Button size="icon-xs" variant="ghost" title={t("markdown.blocks.insert")} aria-label={t("markdown.blocks.insert")} onMouseDown={event => event.preventDefault()} onClick={addBelow}><Plus /></Button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        {/* A click opens actions; holding and moving the same handle reorders the block. */}
        <DropdownMenuTrigger
          onMouseDown={event => event.preventBaseUIHandler()}
          onClick={event => {
            event.preventBaseUIHandler();
            if (suppressClick.current) { suppressClick.current = false; return; }
            setMenuOpen(open => !open);
          }}
          render={<Button size="icon-xs" variant="ghost" data-block-drag-handle
            aria-label={t("markdown.blocks.actions")} title={t("markdown.blocks.move_hint")}
            onPointerDown={event => {
              if (event.button !== 0 || !event.isPrimary) return;
              event.preventDefault();
              suppressClick.current = false;
              dragging.current = { key: hover.key, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onLostPointerCapture={() => { dragging.current = null; setDrop(null); }}
          />}><GripVertical /></DropdownMenuTrigger>
        <DropdownMenuContent data-markdown-block-ui className="min-w-48" side="right">
          <DropdownMenuItem onClick={addBelow}><Plus />{t("markdown.blocks.insert")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => move("up")}><ArrowUp />{t("markdown.blocks.move_up")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => move("down")}><ArrowDown />{t("markdown.blocks.move_down")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => { rootEditor.update(() => { $deleteDocumentBlock(hover.key); }); setMenuOpen(false); setHover(null); }}><Trash2 />{t("markdown.blocks.delete")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>}
    {drop && <div className="lw-block-drop-line" style={{ left: drop.block.left, width: drop.block.right - drop.block.left, top: drop.after ? drop.block.bottom + 3 : drop.block.top - 3 }} />}
    {slash && <div ref={insertMenu} data-markdown-block-ui className="lw-block-insert-menu" role="listbox" aria-label={t("markdown.blocks.insert")} style={{ left: Math.max(8, Math.min(slash.left, window.innerWidth - 290)), top: Math.max(8, Math.min(slash.top, window.innerHeight - 310)) }} onMouseDown={event => event.preventDefault()}>
      <div className="lw-block-menu-label">{t("markdown.blocks.insert")}</div>
      {matches.map((command, index) => <button key={command.id} type="button" role="option" aria-selected={index === selectedCommand} className="lw-block-insert-option" onMouseEnter={() => setSelectedCommand(index)} onClick={() => insert(command.id)}><command.icon size={17} /><span>{command.label}</span></button>)}
      {!matches.length && <div className="lw-block-menu-label">{t("markdown.blocks.no_results")}</div>}
    </div>}
    {selection && !slash && <div data-markdown-block-ui className="lw-selection-toolbar" role="toolbar" aria-label={t("markdown.blocks.format")} style={{ left: Math.max(115, Math.min(window.innerWidth - 115, selection.left)), top: Math.max(50, selection.top) }} onMouseDown={event => event.preventDefault()}>
      <Button size="icon-sm" variant="ghost" aria-label={t("markdown.toolbar.bold")} aria-pressed={selection.formats.includes("bold")} onClick={() => format("bold")}><Bold /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={t("markdown.toolbar.italic")} aria-pressed={selection.formats.includes("italic")} onClick={() => format("italic")}><Italic /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={t("markdown.toolbar.strikethrough")} aria-pressed={selection.formats.includes("strikethrough")} onClick={() => format("strikethrough")}><Strikethrough /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={t("markdown.toolbar.inlineCode")} aria-pressed={selection.formats.includes("code")} onClick={() => format("code")}><Code /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={t("markdown.toolbar.link")} onClick={() => editLink()}><Link /></Button>
    </div>}
  </>, document.body);
}

export const markdownBlocksPlugin = realmPlugin({ init(realm) { realm.pub(addComposerChild$, MarkdownBlockControls); } });
