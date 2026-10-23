/** @jsxImportSource react */
/**
 * Ilustrácie a diagramy sprievodcu (C1) v štýle `TaskIllustration`: inline SVG s tokenmi LAWOSS, svetlý aj
 * tmavý režim. Obrázky sú dekorácia (`aria-hidden`); význam nesie vždy text vedľa nich. Diagramy s textom
 * sú HTML zoznamy s ikonami, aby sa popisy zalomili v úzkom okne a čítačka ich prečítala v poradí.
 */
import { useId, type ReactNode } from "react";

/** Spoločný rám obrázka: plocha, okraj a jemný tieň v zlatej akcentovej farbe. */
function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  const shadow = useId();
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 160 96" fill="none" className={`lw-wiz-illustration ${className}`}>
      <defs>
        <filter id={shadow} x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--lw-illustration-accent)" floodOpacity=".14" />
        </filter>
      </defs>
      <g filter={`url(#${shadow})`}>{children}</g>
    </svg>
  );
}

/** Kancelária: budova so stĺpmi a menovka (krok 1). */
export function OfficeIllustration() {
  return (
    <Frame>
      <path d="M36 34 80 14l44 20Z" fill="var(--lw-surface)" stroke="var(--lw-border-strong)" strokeLinejoin="round" />
      <path d="M80 20v8" stroke="var(--lw-illustration-accent)" strokeWidth="3" strokeLinecap="round" />
      <rect x="40" y="34" width="80" height="6" rx="2" fill="var(--lw-surface)" stroke="var(--lw-border-strong)" />
      {[50, 66, 82, 98].map((x) => (
        <rect key={x} x={x} y="42" width="8" height="30" rx="2" fill="var(--lw-surface)" stroke="var(--lw-border)" />
      ))}
      <rect x="34" y="72" width="92" height="8" rx="2" fill="var(--lw-surface)" stroke="var(--lw-border-strong)" />
      <rect x="104" y="52" width="44" height="26" rx="5" fill="var(--lw-surface)" stroke="var(--lw-illustration-accent)" />
      <path d="M111 61h24M111 69h16" stroke="var(--lw-border-strong)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="142" cy="56" r="7" fill="var(--lw-illustration-accent)" />
      <path d="m139 56 2 2 4-4" stroke="var(--lw-surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** Existujúci priečinok: priečinok so stromom pod ním (krok 2, „Pripojiť“). */
export function FolderConnectIllustration() {
  return (
    <Frame>
      <path d="M22 26a5 5 0 0 1 5-5h20l6 6h30a5 5 0 0 1 5 5v34a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5Z" fill="var(--lw-surface)" stroke="var(--lw-border-strong)" />
      <path d="M32 42h40M32 50h32M32 58h36" stroke="var(--lw-border-strong)" strokeWidth="2" strokeLinecap="round" />
      <path d="M96 48h14" stroke="var(--lw-illustration-accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 3" />
      <path d="m106 44 4 4-4 4" stroke="var(--lw-illustration-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="114" y="22" width="30" height="16" rx="4" fill="var(--lw-surface)" stroke="var(--lw-illustration-accent)" />
      <rect x="120" y="44" width="26" height="12" rx="3" fill="var(--lw-surface)" stroke="var(--lw-border-strong)" />
      <rect x="120" y="62" width="26" height="12" rx="3" fill="var(--lw-surface)" stroke="var(--lw-border-strong)" />
      <path d="M117 38v30h3M117 50h3" stroke="var(--lw-border)" strokeWidth="1.5" />
      <path d="M119 30h16" stroke="var(--lw-illustration-accent)" strokeWidth="2" strokeLinecap="round" />
    </Frame>
  );
}

/** Nový priečinok: prázdny priečinok s plusom a kanceláriou (krok 2, „Začať nanovo“). */
export function FolderFreshIllustration() {
  return (
    <Frame>
      <path d="M34 28a5 5 0 0 1 5-5h22l6 6h50a5 5 0 0 1 5 5v36a5 5 0 0 1-5 5H39a5 5 0 0 1-5-5Z" fill="var(--lw-surface)" stroke="var(--lw-border-strong)" strokeDasharray="4 3" />
      <circle cx="80" cy="52" r="13" fill="var(--lw-illustration-accent)" opacity=".16" />
      <path d="M80 45v14M73 52h14" stroke="var(--lw-illustration-accent)" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="104" y="58" width="30" height="12" rx="3" fill="var(--lw-surface)" stroke="var(--lw-border-strong)" />
      <path d="M109 64h18" stroke="var(--lw-border-strong)" strokeWidth="2" strokeLinecap="round" />
    </Frame>
  );
}

/** Pripravené: zaškrtnutý zoznam s bublinou chatu (krok 6). */
export function ReadyIllustration() {
  return (
    <Frame>
      <rect x="30" y="16" width="70" height="64" rx="6" fill="var(--lw-surface)" stroke="var(--lw-border-strong)" />
      {[30, 46, 62].map((y, index) => (
        <g key={y}>
          <circle cx="43" cy={y} r="5" fill={index < 2 ? "var(--lw-illustration-accent)" : "var(--lw-surface)"} stroke="var(--lw-illustration-accent)" />
          {index < 2 ? <path d={`m40.5 ${y} 1.8 1.8 3.2-3.4`} stroke="var(--lw-surface)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /> : null}
          <path d={`M54 ${y}H${index === 1 ? 82 : 90}`} stroke="var(--lw-border-strong)" strokeWidth="2" strokeLinecap="round" />
        </g>
      ))}
      <path d="M96 42h38a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6h-22l-8 7v-7h-8a6 6 0 0 1-6-6V48a6 6 0 0 1 6-6Z" fill="var(--lw-surface)" stroke="var(--lw-illustration-accent)" />
      <path d="M104 54h26M104 61h18" stroke="var(--lw-border-strong)" strokeWidth="2" strokeLinecap="round" />
    </Frame>
  );
}

/** Šípka medzi uzlami diagramu; v úzkom okne sa otočí nadol (CSS). */
export function FlowArrow() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="lw-wiz-flow-arrow" fill="none">
      <path d="M4 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type FlowNode = { key: string; icon: ReactNode; label: string; emphasis?: boolean };

/**
 * Diagram toku (Prečíta → Navrhne → Vy schválite → Vykoná; Dokumenty → Asistent → Poskytovateľ):
 * usporiadaný zoznam, šípky sú dekorácia. `emphasis` zvýrazní krok, ktorý patrí advokátovi (tvarom aj textom).
 */
export function FlowDiagram({ label, nodes }: { label: string; nodes: readonly FlowNode[] }) {
  return (
    <ol className="lw-wiz-flow" aria-label={label}>
      {nodes.map((node, index) => (
        <li key={node.key} className="lw-wiz-flow-item">
          {index > 0 ? <FlowArrow /> : null}
          <span className="lw-wiz-flow-node" data-emphasis={node.emphasis ? "true" : undefined}>
            <span className="lw-wiz-flow-icon" aria-hidden="true">{node.icon}</span>
            <span className="lw-wiz-flow-label">{node.label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
