import type { WikiGraphData } from "@legalwork/types/wiki";
import { wikiGraphSeed, type GraphLayoutPin, type GraphLayoutRequest, type GraphLayoutUpdate } from "./wiki-graph-data";
import { readGraphPositions, saveGraphPositions, type WikiGraphCamera } from "./wiki-graph-state";

export type GraphCallbacks = { onOpen: (path: string) => void; onCamera: (camera: WikiGraphCamera) => void; onRunning: (running: boolean) => void; onError: (error: string | null) => void };
export interface GraphController {
  setData(data: WikiGraphData): void;
  focus(id: string): void;
  zoom(direction: number): void;
  fit(): void;
  pan(x: number, y: number): void;
  pause(manual?: boolean): void;
  arrange(): void;
  dispose(): void;
}
type Point = { id: string; path: string; title: string; x: number; y: number; size: number };

/** Automatic recovery uses the same controls, positions and worker as the GPU view. */
export class CanvasGraphRenderer implements GraphController {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly resize: ResizeObserver;
  private readonly theme: MutationObserver;
  private readonly saved = new Map<string, { x: number; y: number }>();
  private nodes: Point[] = [];
  private edges: { source: Point; target: Point }[] = [];
  private byId = new Map<string, Point>();
  private buckets = new Map<string, { point: Point; x: number; y: number }[]>();
  private camera: WikiGraphCamera;
  private bounds = { x: 0, y: 0, size: 100 };
  private hovered: string | null = null;
  private adjacent = new Set<string>();
  private drag?: { x: number; y: number; moved: boolean; node?: Point };
  private worker?: Worker;
  private generation = 0;
  private frame = 0;
  private disposed = false;
  private ready = false;
  private allowed = true;
  private latest?: WikiGraphData;

  constructor(private readonly container: HTMLElement, private readonly key: string, private readonly callbacks: GraphCallbacks, camera?: WikiGraphCamera) {
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Canvas initialization failed");
    this.context = context;
    this.camera = camera ?? { x: 0.5, y: 0.5, ratio: 1, angle: 0 };
    this.canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:none";
    container.replaceChildren(this.canvas);
    this.resize = new ResizeObserver(() => this.schedule()); this.resize.observe(container);
    this.theme = new MutationObserver(() => this.schedule()); this.theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    this.canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this.down);
    this.canvas.addEventListener("pointermove", this.move);
    this.canvas.addEventListener("pointerup", this.up);
    this.canvas.addEventListener("pointercancel", this.cancel);
    this.canvas.addEventListener("pointerleave", this.leave);
    document.addEventListener("visibilitychange", this.visibility);
    void readGraphPositions(key).then((positions) => {
      if (this.disposed) return;
      for (const point of positions) this.saved.set(point.id, point);
      this.ready = true;
      if (this.latest) this.setData(this.latest);
    });
  }
  private visibility = () => { if (document.hidden) this.pause(); };
  private schedule = () => { if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); };
  private scale() { return Math.max(1, Math.min(this.container.clientWidth, this.container.clientHeight) - 80) / this.bounds.size / this.camera.ratio; }
  private screen(point: { x: number; y: number }) {
    const scale = this.scale();
    return { x: this.container.clientWidth / 2 + (point.x - this.bounds.x - (this.camera.x - 0.5) * this.bounds.size) * scale,
      y: this.container.clientHeight / 2 - (point.y - this.bounds.y - (this.camera.y - 0.5) * this.bounds.size) * scale };
  }
  private draw() {
    const width = this.container.clientWidth, height = this.container.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) { this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr); }
    const ctx = this.context, dark = document.documentElement.classList.contains("dark");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const screen = new Map(this.nodes.map((node) => [node.id, this.screen(node)]));
    ctx.strokeStyle = dark ? "#41414a" : "#dddfe3"; ctx.lineWidth = 0.55; ctx.beginPath();
    for (const edge of this.edges) {
      const source = screen.get(edge.source.id), target = screen.get(edge.target.id);
      if (!source || !target || (source.x < 0 && target.x < 0) || (source.x > width && target.x > width) || (source.y < 0 && target.y < 0) || (source.y > height && target.y > height)) continue;
      ctx.moveTo(source.x, source.y); ctx.lineTo(target.x, target.y);
    }
    ctx.stroke();
    this.buckets.clear();
    const labels = new Set<string>(); ctx.font = "12px system-ui"; ctx.textAlign = "center";
    for (const node of this.nodes) {
      const point = screen.get(node.id); if (!point || point.x < -20 || point.x > width + 20 || point.y < -20 || point.y > height + 20) continue;
      const highlighted = node.id === this.hovered || this.adjacent.has(node.id);
      ctx.fillStyle = highlighted ? "#d99723" : dark ? "#a1a1aa" : "#68717d";
      ctx.beginPath(); ctx.arc(point.x, point.y, node.size, 0, Math.PI * 2); ctx.fill();
      const bucket = `${Math.floor(point.x / 32)},${Math.floor(point.y / 32)}`;
      const entries = this.buckets.get(bucket) ?? []; entries.push({ point: node, ...point }); this.buckets.set(bucket, entries);
      const labelCell = `${Math.floor(point.x / 140)},${Math.floor(point.y / 38)}`;
      if ((highlighted || this.nodes.length < 100 || this.camera.ratio < 0.2 || node.size > 6) && (highlighted || !labels.has(labelCell))) {
        labels.add(labelCell); ctx.fillStyle = dark ? "#d4d4d8" : "#52525b"; ctx.fillText(node.title, point.x, point.y + node.size + 16, 240);
      }
    }
  }
  private hit(x: number, y: number) {
    let closest: Point | undefined, distance = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const item of this.buckets.get(`${Math.floor(x / 32) + dx},${Math.floor(y / 32) + dy}`) ?? []) {
      const d = Math.hypot(item.x - x, item.y - y); if (d < item.point.size + 7 && d < distance) { closest = item.point; distance = d; }
    }
    return closest;
  }
  private local(event: PointerEvent) { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  private down = (event: PointerEvent) => { if (event.button !== 0) return; const point = this.local(event); this.drag = { ...point, moved: false, node: this.hit(point.x, point.y) }; this.canvas.setPointerCapture(event.pointerId); };
  private move = (event: PointerEvent) => {
    const point = this.local(event);
    if (this.drag) {
      const dx = point.x - this.drag.x, dy = point.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
      this.drag.moved = true;
      if (this.drag.node) { if (!this.worker) this.arrange(); this.drag.node.x += dx / this.scale(); this.drag.node.y -= dy / this.scale(); this.pin(this.drag.node, true); }
      else this.pan(-dx / Math.max(1, Math.min(this.container.clientWidth, this.container.clientHeight) - 80), dy / Math.max(1, Math.min(this.container.clientWidth, this.container.clientHeight) - 80));
      this.drag.x = point.x; this.drag.y = point.y; this.schedule(); return;
    }
    const node = this.hit(point.x, point.y); this.canvas.style.cursor = node ? "pointer" : "grab";
    if ((node?.id ?? null) === this.hovered) return;
    this.hovered = node?.id ?? null; this.adjacent.clear();
    if (node) for (const edge of this.edges) { if (edge.source.id === node.id) this.adjacent.add(edge.target.id); if (edge.target.id === node.id) this.adjacent.add(edge.source.id); }
    this.schedule();
  };
  private up = (event: PointerEvent) => { const drag = this.drag; this.drag = undefined; this.canvas.releasePointerCapture(event.pointerId); if (!drag) return; if (!drag.moved && drag.node) this.callbacks.onOpen(drag.node.path); else { if (drag.node) this.pin(drag.node, false); this.persist(); } };
  private cancel = () => { if (this.drag?.node) this.pin(this.drag.node, false); this.drag = undefined; this.persist(); };
  private leave = () => { if (!this.drag) { this.hovered = null; this.adjacent.clear(); this.schedule(); } };
  private wheel = (event: WheelEvent) => { event.preventDefault(); this.zoom(Math.max(-1, Math.min(1, event.deltaY / 100))); };
  zoom(direction: number) { this.camera.ratio = Math.max(0.002, Math.min(20, this.camera.ratio * Math.pow(1.5, direction))); this.callbacks.onCamera(this.camera); this.schedule(); }
  fit() { this.camera = { x: 0.5, y: 0.5, ratio: 1, angle: 0 }; this.callbacks.onCamera(this.camera); this.schedule(); }
  pan(x: number, y: number) { this.camera.x += x * this.camera.ratio; this.camera.y += y * this.camera.ratio; this.callbacks.onCamera(this.camera); this.schedule(); }
  focus(id: string) { const node = this.byId.get(id); if (!node) return; this.camera = { x: (node.x - this.bounds.x) / this.bounds.size + 0.5, y: (node.y - this.bounds.y) / this.bounds.size + 0.5, ratio: Math.min(0.15, this.camera.ratio), angle: 0 }; this.hovered = id; this.callbacks.onCamera(this.camera); this.schedule(); }
  setData(data: WikiGraphData) {
    this.latest = data; if (!this.ready) return;
    this.pause(false); for (const node of this.nodes) this.saved.set(node.id, node);
    let added = false;
    this.nodes = data.nodes.map((node, index) => { const saved = this.saved.get(node.id); added ||= !saved; return { ...node, ...(saved ?? wikiGraphSeed(index, data.nodes.length)), size: 3 }; });
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    this.edges = data.edges.flatMap((edge) => { const source = this.byId.get(edge.source), target = this.byId.get(edge.target); return source && target ? [{ source, target }] : []; });
    const degrees = new Map<string, number>(); for (const edge of this.edges) for (const node of [edge.source, edge.target]) degrees.set(node.id, (degrees.get(node.id) ?? 0) + 1);
    for (const node of this.nodes) node.size = Math.min(12, (this.nodes.length < 100 ? 5 : 2.5) + Math.log2(1 + (degrees.get(node.id) ?? 0)));
    this.measure(); this.schedule(); if (added && this.allowed && !document.hidden) this.arrange();
  }
  private measure() { let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; for (const node of this.nodes) { minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x); minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y); } if (this.nodes.length) this.bounds = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, size: Math.max(1, maxX - minX, maxY - minY) }; }
  arrange() {
    this.pause(false); if (!this.nodes.length) return; this.allowed = true;
    const positions = new Float32Array(this.nodes.length * 2), indices = new Map(this.nodes.map((node, index) => [node.id, index]));
    this.nodes.forEach((node, index) => { positions[index * 2] = node.x; positions[index * 2 + 1] = node.y; });
    const edges = new Uint32Array(this.edges.length * 2); this.edges.forEach((edge, index) => { edges[index * 2] = indices.get(edge.source.id) ?? 0; edges[index * 2 + 1] = indices.get(edge.target.id) ?? 0; });
    const generation = ++this.generation;
    try {
      this.worker = new Worker(new URL("./wiki-graph-layout.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<GraphLayoutUpdate>) => { if (event.data.generation !== this.generation || this.disposed) return; this.nodes.forEach((node, index) => { if (this.drag?.node === node) return; node.x = event.data.positions[index * 2]; node.y = event.data.positions[index * 2 + 1]; }); this.measure(); this.schedule(); if (event.data.finished) { this.pause(false); this.persist(); } };
      this.worker.onerror = (error) => { console.error("Wiki graph layout failed:", error); this.pause(false); };
      const request: GraphLayoutRequest = { positions, edges, generation, durationMs: 15_000 }; this.worker.postMessage(request, [positions.buffer, edges.buffer]); this.callbacks.onRunning(true);
    } catch (error) { console.error("Wiki graph layout failed:", error); this.pause(false); }
  }
  private pin(node: Point, fixed: boolean) { const index = this.nodes.indexOf(node); if (index < 0) return; const message: GraphLayoutPin = { index, x: fixed ? node.x : null, y: fixed ? node.y : null }; this.worker?.postMessage(message); }
  pause(manual = true) { if (manual) this.allowed = false; this.generation++; this.worker?.terminate(); this.worker = undefined; this.callbacks.onRunning(false); }
  private persist() { for (const node of this.nodes) this.saved.set(node.id, node); void saveGraphPositions(this.key, [...this.saved].map(([id, point]) => ({ id, x: point.x, y: point.y }))); }
  dispose() { this.disposed = true; this.pause(false); this.persist(); this.callbacks.onCamera(this.camera); this.resize.disconnect(); this.theme.disconnect(); document.removeEventListener("visibilitychange", this.visibility); cancelAnimationFrame(this.frame); this.canvas.remove(); }
}
