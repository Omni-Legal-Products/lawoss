import { decodeText, type OkfEntry, type OkfReadSource } from '../../okf-reader/src/index.ts';
export type VaultReadPort = { entries(path: string): Promise<OkfEntry[]>; binary(path: string): Promise<ArrayBuffer> };
/** No metadata cache: fresh Vault bytes also support UTF-8/UTF-16 BOM. */
export function createVaultSource(port: VaultReadPort): OkfReadSource {
  return {
    list: async path => {
      const entries = await port.entries(path);
      return { entries: entries.slice(0, 2000), truncated: entries.length > 2000 };
    },
    readText: async path => {
      const text = decodeText(new Uint8Array(await port.binary(path)));
      if (/^<<<<<<< /m.test(text)) throw new Error('Unresolved merge conflict');
      return text;
    },
  };
}
