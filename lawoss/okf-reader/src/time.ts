/** Shared refresh policy and local calendar day. */
export const OKF_REFRESH_MS = 15_000;
/** Strop pre veľkú kanceláriu: obnova nesmie bežať dlhšie, než trvá samotné čítanie. */
const OKF_REFRESH_MAX_MS = 120_000;

/** 15 s, alebo desaťnásobok posledného čítania, najviac 2 minúty. */
export function okfRefreshInterval(lastReadMs: number | undefined): number {
  return Math.min(OKF_REFRESH_MAX_MS, Math.max(OKF_REFRESH_MS, Math.round((lastReadMs ?? 0) * 10)));
}


export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
