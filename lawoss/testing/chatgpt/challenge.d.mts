export type DeviceChallenge = { code: string; expiresAt: number; model: string; platform: string; run: string; sha: string; url: string };
export function recipientKey(encoded: string): import('node:crypto').KeyObject;
export function encryptChallenge(value: DeviceChallenge, publicKey: string): Record<string, string | number>;
export function decryptChallenge(envelope: unknown, privateKey: string, passphrase?: string): DeviceChallenge;
