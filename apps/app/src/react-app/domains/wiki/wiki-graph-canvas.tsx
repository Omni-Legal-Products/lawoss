import { useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { pathLine } from "sigma/rendering";
import { Maximize, Minus, Pause, Play, Plus } from "lucide-react";
import type { WikiGraphData } from "@legalwork/types/wiki";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { wikiGraphSeed, type GraphLayoutPin, type GraphLayoutRequest, type GraphLayoutUpdate } from "./wiki-graph-data";
import { disableSigmaGlyphPicking } from "./wiki-graph-sigma-compat";
import { selectGraphLabels, type GraphLabelCandidate } from "./wiki-graph-labels";
import { CanvasGraphRenderer, type GraphController, type GraphCallbacks } from "./wiki-graph-fallback";
import { readGraphPositions, saveGraphPositions, type WikiGraphCamera, type WikiGraphPosition } from "./wiki-graph-state";
import { observeGraphViewport } from "./wiki-graph-viewport";

type Node = { x: number; y: number; size: number; color: string; labelColor: string; backdropColor: string; label: string; path: string };
type Edge = { color: string; size: number };
type LabelState = { labelVisible: boolean };
type Callbacks = GraphCallbacks;

/** One renderer survives graph deltas, filter changes and camera movement. */
class WikiGraphRenderer implements GraphController {
  readonly graph = new Graph<Node, Edge>({ multi: true, type: "directed", allowSelfLoops: false });
  readonly sigma: Sigma<Node, Edge, {}, LabelState>;
  private worker?: Worker;
  private generation = 0;
  private indices = new Map<string, number>();
  private dragged: string | null = null;
  private animation = 0;
  private targets?: Float32Array;
  private targetFinished = false;
  private lastFrame = 0;
  private highlighted: string[] = [];
  private highlightedEdges: string[] = [];
  private readonly saved = new Map<string, { x: number; y: number }>();
  private dark = document.documentElement.classList.contains("dark");
  private readonly themeObserver: MutationObserver;
  private layoutAllowed = true;
  private disposed = false;
  private cameraTimer?: ReturnType<typeof setTimeout>;
  private cachedPositionsLoaded = false;
  private latest?: WikiGraphData;
  private deferredData = false;
  private framed = false;
  private autoFitPending: boolean;
  private readonly labelWidths = new Map<string, number>();
  private readonly labelMeasure = document.createElement("canvas").getContext("2d");
  private visibleLabels = new Set<string>();
  private readonly stopViewport: () => void;

  constructor(private readonly container: HTMLElement, private readonly key: string, private readonly callbacks: Callbacks, camera?: WikiGraphCamera) {
    this.autoFitPending = !camera;
    if (this.labelMeasure) this.labelMeasure.font = "14px Arial";
    disableSigmaGlyphPicking();
    this.sigma = new Sigma<Node, Edge, {}, LabelState>(this.graph, container, {
      customNodeState: { labelVisible: false },
      primitives: { edges: { paths: [pathLine()] } },
      settings: {
        // Fixed-width labels can exceed a split pane and make label-based fitting diverge.
        allowInvalidContainer: true, itemSizesReference: "screen", autoRescale: true, autoRescaleContent: "nodes", stagePadding: 40,
        renderEdgeLabels: false, enableEdgeEvents: false, enableNodeDrag: true, nodeLabelEvents: "separate",
        nodePickingPadding: 5, minCameraRatio: 0.002, maxCameraRatio: 20,
        labelDensity: 0.12, labelGridCellSize: 110, labelRenderedSizeThreshold: 6,
        zoomToSizeRatioFunction: (ratio) => Math.min(Math.sqrt(ratio), 1.6),
        hideLabelsOnMove: true, antialiasEdges: true, enableCameraRotation: false, enableCameraMouseRotation: false,
      },
      styles: {
        nodes: { x: { attribute: "x" }, y: { attribute: "y" }, size: { attribute: "size" }, label: { attribute: "label" }, opacity: (_attrs, state, graph) => !graph.hasHighlighted || state.isHighlighted ? 1 : 0.2, labelVisibility: (_attrs, state) => state.labelVisible ? "visible" : "hidden", color: { whenState: "isHighlighted", then: this.dark ? "#e4e4e7" : "#353c47", else: { attribute: "color" } }, labelSize: 14, labelFont: "Arial", labelColor: { attribute: "labelColor" }, labelPosition: "below", backdropColor: { attribute: "backdropColor" }, backdropShadowBlur: 0, backdropArea: "label" },
        edges: { opacity: (_attrs, state, graph) => !graph.hasHighlighted || state.isHighlighted ? 0.6 : 0.08, color: { whenState: "isHighlighted", then: this.dark ? "#a1a1aa" : "#6b7280", else: { attribute: "color" } }, size: { whenState: "isHighlighted", then: 1.4, else: 0.45 } },
      },
    });
    this.sigma.on("beforeRender", this.selectLabels);
    this.sigma.on("afterProcess", this.selectLabels);
    container.addEventListener("pointerdown", this.cancelAutoFit);
    container.addEventListener("wheel", this.cancelAutoFit, { passive: true });
    if (camera) this.sigma.getCamera().setState(camera);
    this.sigma.getCamera().on("updated", (state) => {
      clearTimeout(this.cameraTimer);
      this.cameraTimer = setTimeout(() => this.callbacks.onCamera(state), 200);
    });
    this.sigma.on("clickNode", ({ node }) => this.callbacks.onOpen(this.graph.getNodeAttribute(node, "path")));
    this.sigma.on("clickNodeLabel", ({ node }) => this.callbacks.onOpen(this.graph.getNodeAttribute(node, "path")));
    this.sigma.on("enterNode", ({ node }) => this.highlight(node));
    this.sigma.on("leaveNode", () => this.highlight(null));
    this.sigma.on("enterNodeLabel", ({ node }) => this.highlight(node));
    this.sigma.on("leaveNodeLabel", () => this.highlight(null));
    this.sigma.on("nodeDragStart", ({ node }) => { this.dragged = node; this.arrange(0.3); this.pin(node, true); });
    this.sigma.on("nodeDrag", ({ node }) => this.pin(node, true));
    this.sigma.on("nodeDragEnd", ({ node }) => { this.pin(node, false); this.dragged = null; this.persist(); });
    this.sigma.on("webglContextLost", () => { this.pause(); this.callbacks.onError(t("wiki.graph_unavailable")); });
    this.sigma.on("webglContextRestored", () => this.callbacks.onError(null));
    this.themeObserver = new MutationObserver(() => {
      const dark = document.documentElement.classList.contains("dark");
      if (dark === this.dark) return;
      this.dark = dark;
      this.graph.updateEachNodeAttributes((_id, attrs) => ({ ...attrs, color: dark ? "#a1a1aa" : "#68717d", labelColor: dark ? "#d4d4d8" : "#52525b", backdropColor: dark ? "#242428" : "#ffffff" }));
      this.graph.updateEachEdgeAttributes((_id, attrs) => ({ ...attrs, color: dark ? "#41414a" : "#dddfe3" }));
      this.sigma.scheduleRefresh();
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", this.visibility);
    this.stopViewport = observeGraphViewport(container, () => {
      this.sigma.resize();
      if (this.deferredData && this.latest) this.setData(this.latest);
      this.sigma.refresh();
    });
    void readGraphPositions(key).then((positions) => {
      if (this.disposed) return;
      for (const position of positions) this.saved.set(position.id, position);
      this.cachedPositionsLoaded = true;
      if (this.latest) this.setData(this.latest);
    });
  }

  private visibility = () => { if (document.hidden) this.pause(); };
  private cancelAutoFit = () => { this.autoFitPending = false; };

  private selectLabels = () => {
    const candidates: GraphLabelCandidate[] = [];
    this.graph.forEachNode((id, attrs) => {
      if (!this.sigma.getNodeDisplayData(id)) return;
      const state = this.sigma.getNodeState(id);
      const size = this.sigma.scaleSize(attrs.size);
      if (this.graph.order >= 100 && size < 6 && !state.isHovered && !state.isLabelHovered) return;
      const point = this.sigma.graphToViewport(attrs);
      const width = this.labelWidths.get(id) ?? 0;
      candidates.push({ id, x: point.x - width / 2 - 6, y: point.y + size + 2, width: width + 12, height: 24, priority: state.isHovered || state.isLabelHovered ? 1000 : attrs.size });
    });
    const { width, height } = this.sigma.getDimensions();
    const next = selectGraphLabels(candidates, width, height);
    for (const id of this.visibleLabels) if (!next.has(id) && this.graph.hasNode(id)) this.sigma.setNodeState(id, { labelVisible: false });
    for (const id of next) if (!this.visibleLabels.has(id)) this.sigma.setNodeState(id, { labelVisible: true });
    this.visibleLabels = next;
  };

  private highlight(id: string | null) {
    for (const node of this.highlighted) if (this.graph.hasNode(node)) this.sigma.setNodeState(node, { isHighlighted: false });
    for (const edge of this.highlightedEdges) if (this.graph.hasEdge(edge)) this.sigma.setEdgeState(edge, { isHighlighted: false });
    this.highlighted = id ? [id, ...this.graph.neighbors(id)] : [];
    this.highlightedEdges = id ? this.graph.edges(id) : [];
    this.sigma.setGraphState({ hasHighlighted: Boolean(id) });
    for (const node of this.highlighted) this.sigma.setNodeState(node, { isHighlighted: true });
    for (const edge of this.highlightedEdges) this.sigma.setEdgeState(edge, { isHighlighted: true });
  }

  setData(data: WikiGraphData) {
    try { this.applyData(data); }
    catch (error) { this.callbacks.onError(error instanceof Error ? error.message : "Graph update failed"); }
  }

  private applyData(data: WikiGraphData) {
    this.latest = data;
    this.deferredData = !this.container.clientWidth || !this.container.clientHeight;
    if (!this.cachedPositionsLoaded || this.deferredData) return;
    this.pause(false);
    const initial = this.graph.order === 0;
    const desiredNodes = new Set(data.nodes.map((node) => node.id));
    const desiredEdges = new Set(data.edges.map((edge) => edge.id));
    this.graph.forEachNode((id, attrs) => { this.saved.set(id, { x: attrs.x, y: attrs.y }); });
    for (const id of this.graph.nodes()) if (!desiredNodes.has(id)) this.graph.dropNode(id);
    for (const id of this.graph.edges()) if (!desiredEdges.has(id)) this.graph.dropEdge(id);
    let newPositions = 0;
    for (const [index, node] of data.nodes.entries()) {
      this.labelWidths.set(node.id, this.labelMeasure?.measureText(node.title).width ?? node.title.length * 8);
      if (this.graph.hasNode(node.id)) this.graph.mergeNodeAttributes(node.id, { label: node.title, path: node.path });
      else {
        const saved = this.saved.get(node.id);
        if (!saved) newPositions++;
        this.graph.addNode(node.id, { ...(saved ?? wikiGraphSeed(index, data.nodes.length)), size: 3, color: this.dark ? "#a1a1aa" : "#68717d", labelColor: this.dark ? "#d4d4d8" : "#52525b", backdropColor: this.dark ? "#242428" : "#ffffff", label: node.title, path: node.path });
      }
    }
    for (const edge of data.edges) if (!this.graph.hasEdge(edge.id) && this.graph.hasNode(edge.source) && this.graph.hasNode(edge.target) && edge.source !== edge.target) {
      this.graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, { color: this.dark ? "#41414a" : "#dddfe3", size: 0.45 });
    }
    // New nodes may not have GPU indices yet. Do not use a size-only fast repaint hint here.
    this.graph.updateEachNodeAttributes((id, attrs) => ({ ...attrs, size: Math.min(12, (this.graph.order < 100 ? 5 : 2.5) + Math.log2(1 + this.graph.degree(id))) }));
    this.sigma.setSetting("labelRenderedSizeThreshold", this.graph.order < 100 ? 0 : 6);
    this.sigma.setSetting("hideLabelsOnMove", this.graph.order >= 100);
    if (!this.framed && this.graph.order) { this.frameGraph(newPositions > 0); this.framed = true; }
    this.sigma.scheduleRefresh();
    if ((initial || newPositions) && this.layoutAllowed && !document.hidden) this.arrange(newPositions ? 1 : 0.2);
  }

  focus(id: string) {
    if (!this.graph.hasNode(id)) return;
    this.cancelAutoFit();
    const node = this.graph.getNodeAttributes(id);
    const position = this.sigma.graphToFramedGraph(node);
    void this.sigma.getCamera().animate({ x: position.x, y: position.y, ratio: Math.min(0.15, this.sigma.getCamera().ratio) }, { duration: 280 });
    this.highlight(id);
  }

  zoom(direction: number) { this.cancelAutoFit(); if (direction < 0) void this.sigma.getCamera().zoomIn(); else void this.sigma.getCamera().zoomOut(); }
  private frameGraph(roomForLayout: boolean) {
    if (!this.graph.order) return;
    if (!roomForLayout) {
      // Fit node positions and radii, then freeze that extent
      // so worker updates cannot change the scale underneath the camera.
      this.sigma.setCustomBBox(null);
      this.sigma.refresh();
      this.sigma.setCustomBBox(this.sigma.getBBox());
      this.sigma.refresh();
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    this.graph.forEachNode((_id, point) => { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); });
    const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
    const radius = Math.max(100, (maxX - minX) * 0.58, (maxY - minY) * 0.58, Math.sqrt(this.graph.order) * 90);
    this.sigma.setCustomBBox({ x: [x - radius, x + radius], y: [y - radius, y + radius] });
    // Sigma 4 setCustomBBox schedules a draw but leaves normalization stale.
    this.sigma.refresh();
  }
  fit() { this.cancelAutoFit(); this.frameGraph(false); void this.sigma.getCamera().reset(); }
  pan(x: number, y: number) { this.cancelAutoFit(); const camera = this.sigma.getCamera(); camera.setState({ x: camera.x + x * camera.ratio, y: camera.y + y * camera.ratio }); }

  arrange(alpha = 1) {
    this.pause(false);
    if (!this.graph.order) return;
    this.layoutAllowed = true;
    const ids = this.graph.nodes();
    const indices = this.indices = new Map(ids.map((id, index) => [id, index]));
    const positions = new Float32Array(ids.length * 2);
    ids.forEach((id, index) => { const point = this.graph.getNodeAttributes(id); positions[index * 2] = point.x; positions[index * 2 + 1] = point.y; });
    const edges = new Uint32Array(this.graph.size * 2);
    let edgeIndex = 0;
    this.graph.forEachEdge((_edge, _attrs, source, target) => {
      edges[edgeIndex++] = indices.get(source) ?? 0;
      edges[edgeIndex++] = indices.get(target) ?? 0;
    });
    this.generation++;
    const generation = this.generation;
    try {
      this.worker = new Worker(new URL("./wiki-graph-layout.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<GraphLayoutUpdate>) => {
        if (event.data.generation !== this.generation || this.disposed) return;
        this.targets = event.data.positions;
        this.targetFinished = event.data.finished;
        if (!this.animation) { this.lastFrame = performance.now(); this.animation = requestAnimationFrame(this.animate); }
      };
      this.worker.onerror = (error) => { console.error("Wiki graph layout failed:", error); this.pause(false); };
      const request: GraphLayoutRequest = { positions, edges, generation, durationMs: 15_000, alpha };
      this.worker.postMessage(request, [positions.buffer, edges.buffer]);
      this.callbacks.onRunning(true);
    } catch (error) { console.error("Wiki graph layout failed:", error); this.pause(false); }
  }

  private pin(id: string, fixed: boolean) {
    const index = this.indices.get(id); if (index === undefined) return;
    const point = this.graph.getNodeAttributes(id);
    const message: GraphLayoutPin = { index, x: fixed ? point.x : null, y: fixed ? point.y : null };
    this.worker?.postMessage(message);
  }

  private animate = (now: number) => {
    this.animation = 0;
    const target = this.targets; if (!target || this.disposed) return;
    const interpolate = this.graph.order <= 5_000;
    const blend = interpolate ? 1 - Math.exp(-Math.min(64, now - this.lastFrame) / 55) : 1; this.lastFrame = now;
    let movement = 0;
    this.graph.updateEachNodeAttributes((id, attrs) => {
      const index = this.indices.get(id); if (index === undefined || id === this.dragged) return attrs;
      const dx = target[index * 2] - attrs.x, dy = target[index * 2 + 1] - attrs.y;
      movement = Math.max(movement, Math.abs(dx), Math.abs(dy));
      attrs.x += dx * blend; attrs.y += dy * blend; return attrs;
    }, { attributes: ["x", "y"] });
    if (interpolate && (movement > 0.05 || !this.targetFinished)) this.animation = requestAnimationFrame(this.animate);
    else if (this.targetFinished) { this.pause(false); this.persist(); if (this.autoFitPending) this.fit(); }
  };

  pause(manual = true) {
    if (manual) this.layoutAllowed = false;
    this.generation++;
    cancelAnimationFrame(this.animation); this.animation = 0; this.targets = undefined;
    this.worker?.terminate(); this.worker = undefined;
    this.callbacks.onRunning(false);
  }

  private persist() {
    this.graph.forEachNode((id, attrs) => this.saved.set(id, { x: attrs.x, y: attrs.y }));
    const positions: WikiGraphPosition[] = [...this.saved].map(([id, point]) => ({ id, ...point }));
    void saveGraphPositions(this.key, positions);
  }

  dispose() {
    this.disposed = true;
    this.pause(false);
    this.persist();
    clearTimeout(this.cameraTimer);
    this.callbacks.onCamera(this.sigma.getCamera().getState());
    this.themeObserver.disconnect();
    this.stopViewport();
    document.removeEventListener("visibilitychange", this.visibility);
    this.container.removeEventListener("pointerdown", this.cancelAutoFit);
    this.container.removeEventListener("wheel", this.cancelAutoFit);
    this.sigma.kill();
  }
}

export default function WikiGraphCanvas(props: { gpu: boolean; data: WikiGraphData; storageKey: string; camera?: WikiGraphCamera; focused: string | null; onOpen: (path: string) => void; onCamera: (camera: WikiGraphCamera) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<GraphController | null>(null);
  const latest = useRef(props); latest.current = props;
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const target = container.current;
    let instance: GraphController | undefined;
    let cancelled = false;
    let starting = false;
    const callbacks: GraphCallbacks = { onOpen: (path) => latest.current.onOpen(path), onCamera: (camera) => latest.current.onCamera(camera), onRunning: setRunning, onError: (error) => {
      if (!error || cancelled || instance instanceof CanvasGraphRenderer) return;
      console.error("Wiki graph renderer recovered with Canvas:", error);
      instance?.dispose();
      instance = new CanvasGraphRenderer(target, props.storageKey, callbacks, latest.current.camera);
      renderer.current = instance; instance.setData(latest.current.data);
    } };
    const start = async () => {
      try {
        if (props.gpu) {
          const { GpuGraphRenderer } = await import("./wiki-graph-gpu");
          if (cancelled) return;
          if (!target.clientWidth || !target.clientHeight) { starting = false; return; }
          instance = new GpuGraphRenderer(target, props.storageKey, callbacks, props.camera);
        } else instance = new WikiGraphRenderer(target, props.storageKey, callbacks, props.camera);
      } catch (error) {
        if (cancelled) return;
        console.error("Wiki graph renderer recovered with Canvas:", error);
        instance = new CanvasGraphRenderer(target, props.storageKey, callbacks, props.camera);
      }
      renderer.current = instance; instance.setData(latest.current.data);
    };
    const stopViewport = observeGraphViewport(target, () => {
      if (starting || cancelled) return;
      starting = true;
      void start();
    });
    return () => { cancelled = true; stopViewport(); instance?.dispose(); renderer.current = null; };
  }, [props.storageKey, props.gpu]);
  useEffect(() => renderer.current?.setData(props.data), [props.data]);
  useEffect(() => { if (props.focused) renderer.current?.focus(props.focused); }, [props.focused]);
  return <div className="wiki-graph-stage" tabIndex={0} role="region" aria-label={t("wiki.graph")} onKeyDown={(event) => {
    const graph = renderer.current;
    if (!graph) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); graph.zoom(-1); }
    else if (event.key === "-") { event.preventDefault(); graph.zoom(1); }
    else if (event.key === "0") { event.preventDefault(); graph.fit(); }
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault(); const step = event.shiftKey ? 0.2 : 0.06;
      graph.pan(event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0);
    }
  }}>
    <div ref={container} className="wiki-graph-webgl" />
    <div className="wiki-graph-camera-controls">
      <Button variant="outline" size="icon-sm" aria-label={t("wiki.graph_zoom_in")} title={t("wiki.graph_zoom_in")} onClick={() => renderer.current?.zoom(-1)}><Plus /></Button>
      <Button variant="outline" size="icon-sm" aria-label={t("wiki.graph_zoom_out")} title={t("wiki.graph_zoom_out")} onClick={() => renderer.current?.zoom(1)}><Minus /></Button>
      <Button variant="outline" size="icon-sm" aria-label={t("wiki.graph_fit")} title={t("wiki.graph_fit")} onClick={() => renderer.current?.fit()}><Maximize /></Button>
      <Button variant="outline" size="icon-sm" aria-label={t(running ? "wiki.graph_pause" : "wiki.graph_resume")} title={t(running ? "wiki.graph_pause" : "wiki.graph_resume")} onClick={() => running ? renderer.current?.pause() : renderer.current?.arrange()}>{running ? <Pause /> : <Play />}</Button>
    </div>


  </div>;
}
