import { Graph } from "@cosmos.gl/graph";
import type { WikiGraphData } from "@legalwork/types/wiki";
import type { GraphCallbacks, GraphController } from "./wiki-graph-fallback";
import { readGraphPositions, saveGraphPositions, type WikiGraphCamera } from "./wiki-graph-state";

const SPACE = 4096;

/** Large graphs keep simulation coordinates on the GPU, without per-tick JS uploads. */
export class GpuGraphRenderer implements GraphController {
  private readonly graph: Graph;
  private readonly labels = document.createElement("canvas");
  private readonly observer: MutationObserver;
  private readonly resize: ResizeObserver;
  private readonly saved = new Map<string, { x: number; y: number }>();
  private data?: WikiGraphData;
  private applied?: WikiGraphData;
  private indices = new Map<string, number>();
  private ready = false;
  private disposed = false;
  private graphicsLost = false;
  private generation = 0;
  private frame = 0;
  private cameraTimer?: ReturnType<typeof setTimeout>;
  private cameraIdleTimer?: ReturnType<typeof setTimeout>;
  private simulating = false;
  private resumeAfterCamera = false;
  private linksHidden = false;
  private hovered?: number;
  private labelIndices: number[] = [];
  private currentCamera?: WikiGraphCamera;
  private dark = document.documentElement.classList.contains("dark");
  private first = true;

  constructor(private readonly container: HTMLDivElement, private readonly key: string, private readonly callbacks: GraphCallbacks, camera?: WikiGraphCamera) {
    this.currentCamera = camera;
    this.graph = new Graph(container, {
      spaceSize: SPACE, pixelRatio: 1, attribution: "", enableDrag: true, enableSimulationDuringZoom: false,
      fitViewOnInit: !camera, fitViewDelay: 500, fitViewPadding: 0.15, fitViewDuration: 300,
      pointDefaultColor: this.dark ? "#a1a1aa" : "#68717d", backgroundColor: this.dark ? "#18181b" : "#ffffff",
      pointDefaultSize: 3, pointGreyoutOpacity: 0.18, linkGreyoutOpacity: 0.08,
      linkDefaultColor: this.dark ? "#34343b" : "#e0e1e4", linkDefaultWidth: 0.5, linkBlending: false,
      scalePointsOnZoom: true, scaleLinksOnZoom: true,
      simulationFriction: 0.6, simulationGravity: 0.08, simulationRepulsion: 1, simulationLinkDistance: 15, simulationDecay: 5000,
      onPointClick: (index) => { const node = this.applied?.nodes[index]; if (node) callbacks.onOpen(node.path); },
      onPointMouseOver: (index) => this.highlight(index), onPointMouseOut: () => this.highlight(undefined),
      onSimulationStart: () => this.running(true), onSimulationUnpause: () => this.running(true),
      onSimulationPause: () => this.running(false),
      onSimulationEnd: () => { this.running(false); void this.persist(); this.drawLabels(); },
      onSimulationTick: () => this.scheduleLabels(),
      onZoomStart: () => this.beginCamera(),
      onZoom: () => { this.scheduleLabels(); clearTimeout(this.cameraTimer); this.cameraTimer = setTimeout(() => this.saveCamera(), 160); },
      onZoomEnd: () => { this.endCamera(); this.drawLabels(); this.saveCamera(); },
      onDragEnd: () => { void this.persist(); this.scheduleLabels(); },
    });
    this.labels.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
    container.append(this.labels);
    this.observer = new MutationObserver(() => {
      this.dark = document.documentElement.classList.contains("dark");
      this.graph.setConfigPartial({ pointDefaultColor: this.dark ? "#a1a1aa" : "#68717d", backgroundColor: this.dark ? "#18181b" : "#ffffff", linkDefaultColor: this.dark ? "#34343b" : "#e0e1e4" }); this.scheduleLabels();
    });
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    this.resize = new ResizeObserver(() => this.scheduleLabels()); this.resize.observe(container);
    document.addEventListener("visibilitychange", this.visibility);
    container.addEventListener("webglcontextlost", this.contextLost, true);
    void Promise.all([this.graph.ready, readGraphPositions(`gpu:${key}`)]).then(([, positions]) => {
      if (this.disposed) return;
      for (const point of positions) this.saved.set(point.id, point);
      this.ready = true;
      if (this.data) void this.apply(this.data).catch((error: unknown) => this.fail(error));
    }).catch((error: unknown) => { if (!this.disposed) callbacks.onError(error instanceof Error ? error.message : "Graph initialization failed"); });
  }

  private running(value: boolean) { this.simulating = value; this.callbacks.onRunning(value); }
  private beginCamera() {
    if (!this.ready) return;
    clearTimeout(this.cameraIdleTimer);
    this.resumeAfterCamera ||= this.simulating;
    this.graph.pause();
    // Dense connections are restored once the camera rests. Data and forces stay complete.
    if (!this.linksHidden && this.applied && this.applied.edges.length > 500_000) {
      this.linksHidden = true; this.graph.setConfigPartial({ renderLinks: false });
    }
  }
  private endCamera() {
    clearTimeout(this.cameraIdleTimer);
    this.cameraIdleTimer = setTimeout(() => {
      if (this.disposed) return;
      if (this.linksHidden) { this.linksHidden = false; this.graph.setConfigPartial({ renderLinks: true }); }
      if (this.resumeAfterCamera && !document.hidden) this.graph.unpause();
      this.resumeAfterCamera = false;
    }, 650);
  }
  private contextLost = () => { this.graphicsLost = true; this.callbacks.onError("Graph graphics context was lost"); };
  private visibility = () => { if (document.hidden) this.pause(); };
  private scheduleLabels = () => { if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(() => { this.frame = 0; this.drawLabels(); }); };
  private drawLabels() {
    if (!this.ready || this.disposed || !this.applied) return;
    const width = this.container.clientWidth, height = this.container.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    const ctx = this.labels.getContext("2d"); if (!ctx) return;
    if (this.labels.width !== Math.round(width * dpr) || this.labels.height !== Math.round(height * dpr)) { this.labels.width = Math.round(width * dpr); this.labels.height = Math.round(height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const positions = this.graph.getTrackedPointPositionsMap({ nonBlocking: true });
    if (this.hovered !== undefined && !positions.has(this.hovered)) this.scheduleLabels();
    const cells = new Set<string>(); ctx.font = "12px system-ui"; ctx.textAlign = "center";
    for (const [index, point] of positions) {
      const selected = index === this.hovered;
      if (!selected && this.graph.getZoomLevel() < 0.55) continue;
      const [x, y] = this.graph.spaceToScreenPosition(point);
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const cell = `${Math.floor(x / 180)},${Math.floor(y / 40)}`; if (!selected && cells.has(cell)) continue; cells.add(cell);
      const node = this.applied.nodes[index]; if (!node) continue;
      const offset = Math.min(18, this.graph.getPointRadiusByIndex(index) ?? 4) + 16;
      ctx.lineWidth = 4; ctx.strokeStyle = this.dark ? "#18181b" : "#ffffff"; ctx.strokeText(node.title, x, y + offset, 270);
      ctx.fillStyle = this.dark ? "#d4d4d8" : "#52525b"; ctx.fillText(node.title, x, y + offset, 270);
    }
  }
  private highlight(index: number | undefined) {
    if (!this.ready) return;
    this.hovered = index;
    const neighbors = index === undefined ? undefined : [index, ...this.graph.getNeighboringPointIndices(index)];
    this.graph.setConfigPartial({ highlightedPointIndices: neighbors, highlightedLinkIndices: neighbors ? this.graph.getConnectedLinkIndices(neighbors) : undefined });
    this.graph.trackPointPositionsByIndices(index === undefined ? this.labelIndices : [index, ...this.labelIndices.filter((item) => item !== index)]);
    this.scheduleLabels();
  }

  setData(data: WikiGraphData) { this.data = data; if (this.ready) void this.apply(data).catch((error: unknown) => this.fail(error)); }
  private fail(error: unknown) { if (!this.disposed) this.callbacks.onError(error instanceof Error ? error.message : "Graph update failed"); }
  private async apply(data: WikiGraphData) {
    const generation = ++this.generation;
    if (this.applied) await this.capture();
    if (this.disposed || generation !== this.generation) return;
    this.graph.pause();
    const positions = new Float32Array(data.nodes.length * 2), sizes = new Float32Array(data.nodes.length);
    const indices = new Map(data.nodes.map((node, index) => [node.id, index]));
    const edges = new Float32Array(data.edges.length * 2);
    const degrees = new Uint32Array(data.nodes.length);
    let edgeCount = 0, newPositions = 0;
    data.edges.forEach((edge) => { const source = indices.get(edge.source), target = indices.get(edge.target); if (source === undefined || target === undefined) return; edges[edgeCount++] = source; edges[edgeCount++] = target; degrees[source]++; degrees[target]++; });
    data.nodes.forEach((node, index) => {
      const saved = this.saved.get(node.id), radius = Math.sqrt((index + 0.5) / Math.max(1, data.nodes.length)) * 1800, angle = index * Math.PI * (3 - Math.sqrt(5));
      if (!saved) newPositions++;
      positions[index * 2] = saved?.x ?? SPACE / 2 + Math.cos(angle) * radius;
      positions[index * 2 + 1] = saved?.y ?? SPACE / 2 + Math.sin(angle) * radius;
      sizes[index] = Math.min(12, 2 + Math.sqrt(degrees[index]) * 0.6);
    });
    this.applied = data; this.indices = indices;
    this.labelIndices = Array.from(degrees.keys()).sort((a, b) => degrees[b] - degrees[a]).slice(0, 60);
    this.graph.setPointPositions(positions, true); this.graph.setPointSizes(sizes); this.graph.setLinks(edgeCount === edges.length ? edges : edges.slice(0, edgeCount));
    this.graph.trackPointPositionsByIndices(this.labelIndices);
    this.graph.render(newPositions ? 1 : 0.15, 0);
    this.graph.start(newPositions ? 1 : 0.15);
    if (this.first && this.currentCamera) this.restoreCamera(this.currentCamera);
    this.first = false;
    if (document.hidden) this.graph.pause();
    this.scheduleLabels();
  }
  private saveCamera() {
    if (!this.ready || this.disposed) return;
    const [x, y] = this.graph.screenToSpacePosition([this.container.clientWidth / 2, this.container.clientHeight / 2]);
    this.currentCamera = { x: x / SPACE, y: y / SPACE, ratio: 1 / this.graph.getZoomLevel(), angle: 0 };
    this.callbacks.onCamera(this.currentCamera);
  }
  private restoreCamera(camera: WikiGraphCamera) {
    const width = this.container.clientWidth, height = this.container.clientHeight, k = 1 / camera.ratio;
    this.graph.setViewTransform({ k, x: width / 2 - k * (camera.x * SPACE + (width - SPACE) / 2), y: height / 2 - k * (SPACE - camera.y * SPACE + (height - SPACE) / 2) });
  }
  zoom(direction: number) { this.graph.setZoomLevel(this.graph.getZoomLevel() * Math.pow(1.5, -direction), 240, false); }
  fit() { this.graph.fitView(300, 0.15, false); }
  pan(x: number, y: number) { this.beginCamera(); this.saveCamera(); if (!this.currentCamera) return; this.restoreCamera({ ...this.currentCamera, x: this.currentCamera.x + x * this.currentCamera.ratio * this.container.clientWidth / SPACE, y: this.currentCamera.y + y * this.currentCamera.ratio * this.container.clientHeight / SPACE }); this.saveCamera(); this.scheduleLabels(); this.endCamera(); }
  focus(id: string) { const index = this.indices.get(id); if (index === undefined) return; this.highlight(index); this.graph.zoomToPointByIndex(index, 300, Math.max(0.8, this.graph.getZoomLevel()), false, false); }
  pause() { this.resumeAfterCamera = false; this.graph.pause(); this.running(false); void this.persist(); }
  arrange() { this.graph.start(0.5); }
  private async capture() {
    const data = this.applied; if (!data || !this.ready) return;
    const positions = await this.graph.getPointPositionsAsync();
    data.nodes.forEach((node, index) => { const x = positions[index * 2], y = positions[index * 2 + 1]; if (Number.isFinite(x) && Number.isFinite(y)) this.saved.set(node.id, { x, y }); });
  }
  private async persist() { try { await this.capture(); await saveGraphPositions(`gpu:${this.key}`, [...this.saved].map(([id, point]) => ({ id, ...point }))); } catch { /* Losing a cache must not stop the graph. */ } }
  dispose() {
    this.saveCamera(); this.disposed = true; this.generation++; this.graph.pause();
    this.observer.disconnect(); this.resize.disconnect(); clearTimeout(this.cameraTimer); clearTimeout(this.cameraIdleTimer); cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.visibility); this.container.removeEventListener("webglcontextlost", this.contextLost, true); this.labels.remove();
    if (this.graphicsLost) { this.graph.destroy(); return; }
    // A lost device must not retain a renderer indefinitely waiting for readback.
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<void>((resolve) => { timeout = setTimeout(resolve, 1500); });
    void Promise.race([this.persist(), deadline]).finally(() => { clearTimeout(timeout); this.graph.destroy(); });
  }
}
