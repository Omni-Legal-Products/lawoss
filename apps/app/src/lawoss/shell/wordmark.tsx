/** @jsxImportSource react */

/**
 * The LAWOSS wordmark from lawoss.app — monoline geometry, not a typeface.
 * Kept stroke-for-stroke identical to `site/src/components/Wordmark.tsx` in the
 * lawoss-web repo so the app and the site cannot drift apart.
 *
 * Inline rather than an <img>: `currentColor` does not cross the image
 * boundary, so a linked SVG would render black on our dark surfaces.
 */
export function LawossWordmark(props: { className?: string }) {
  return (
    <svg
      viewBox="-4 -4 640 108"
      className={props.className}
      role="img"
      aria-label="LAWOSS"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="butt"
      strokeLinejoin="miter"
    >
      <path d="M 0.0 0 V 100.0 H 58.0" />
      <path d="M 92.0 100.0 L 134.0 0 L 176.0 100.0" />
      <path d="M 210.0 0 L 235.0 100.0 L 260.0 0 L 285.0 100.0 L 310.0 0" />
      <path d="M 394.0 2.0 A 48.0 48.0 0 1 1 393.99 2.0 Z" />
      <path d="M 536.0 20 C 536.0 6, 520.0 1, 508.0 1 C 490.0 1, 480.0 9, 480.0 23 C 480.0 37, 496.0 43, 508.0 50 C 522.0 57, 536.0 64, 536.0 78 C 536.0 92, 522.0 99, 508.0 99 C 490.0 99, 480.0 92, 480.0 79" />
      <path d="M 630.0 20 C 630.0 6, 614.0 1, 602.0 1 C 584.0 1, 574.0 9, 574.0 23 C 574.0 37, 590.0 43, 602.0 50 C 616.0 57, 630.0 64, 630.0 78 C 630.0 92, 616.0 99, 602.0 99 C 584.0 99, 574.0 92, 574.0 79" />
    </svg>
  );
}
