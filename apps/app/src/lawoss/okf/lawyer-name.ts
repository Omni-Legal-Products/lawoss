import { DEFAULT_DOCUMENT_AUTHOR, normalizeDocumentAuthor } from "@/app/lib/document-author";

/** A fallback editor label is not a lawyer identity or a grant of authority. */
export function lawyerName(documentAuthor: unknown): string | undefined {
  const name = normalizeDocumentAuthor(documentAuthor);
  return name === DEFAULT_DOCUMENT_AUTHOR ? undefined : name;
}

/**
 * Autor dokumentov po onboardingu: vlastné meno z Personalizácie ostáva, inak sa doplní meno
 * advokáta z onboardingu. Bez toho Nový spis hlásil „meno nie je nastavené“ (D1 2026-10-04).
 */
export function authorAfterOnboarding(current: string, onboardingLawyer: string | undefined): string {
  if (lawyerName(current)) return current;
  const lawyer = lawyerName(onboardingLawyer);
  return lawyer ?? current;
}
