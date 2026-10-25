/**
 * N-A5-5 (test 25. 10. 2026): po „Náhľad zmien“ (dolu na stránke) sa odmietnutie vnoreného klienta zobrazilo navrchu
 * stránky, mimo zorného poľa; advokát si myslel, že tlačidlo nefunguje, a klikol znova. Hláška sa posunie do
 * zorného poľa a dostane fokus (čítačka ju prečíta, Tab pokračuje od nej k ponuke „Otvoriť v klientovi …“).
 */
export function revealError(element: Pick<HTMLElement, "scrollIntoView" | "focus"> | null, reducedMotion: boolean): void {
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  element.focus({ preventScroll: true });
}
