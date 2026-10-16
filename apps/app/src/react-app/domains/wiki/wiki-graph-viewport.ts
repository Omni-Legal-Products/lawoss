/** Hidden tabs have no usable viewport. Wait for layout, and refresh on every reveal. */
export function observeGraphViewport(container: HTMLElement, onVisible: () => void) {
  const visible = () => { if (container.clientWidth > 0 && container.clientHeight > 0) onVisible(); };
  const observer = new ResizeObserver(visible);
  observer.observe(container);
  visible();
  return () => observer.disconnect();
}
