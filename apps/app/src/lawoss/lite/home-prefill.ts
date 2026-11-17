/**
 * Veta z poľa chatu na Dnes pre Domov (nový chat): Dnes ju sem odloží a otvorí `/home`, Domov si ju vezme ako
 * počiatočný text poľa správy (`app-home.tsx`, 🟡 LAWOSS). Nič sa neodosiela ani nezakladá; klienta si advokát
 * vyberie na Domove. Len v pamäti, nikdy v adrese (URL), a len krátko, aby neskoršie otvorenie Domova nezdedilo
 * starú vetu, keď sa navigácia nepodarí.
 */
const TTL_MS = 10_000;

let pending: { text: string; at: number } | null = null;

export function requestHomePrefill(text: string, now: number = Date.now()): void {
  const trimmed = text.trim();
  pending = trimmed ? { text: trimmed, at: now } : null;
}

/**
 * Text pre počiatočný stav poľa. Len číta (React môže inicializátor stavu zavolať dvakrát, StrictMode);
 * zahodí ho `clearHomePrefill` po pripojení Domova.
 */
export function peekHomePrefill(now: number = Date.now()): string {
  if (pending && now - pending.at > TTL_MS) pending = null;
  return pending?.text ?? "";
}

export function clearHomePrefill(): void {
  pending = null;
}
