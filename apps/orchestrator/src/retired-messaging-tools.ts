import { randomUUID } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

/** Retire previously generated bot tools without discarding local edits. */
export async function retireMessagingTools(configDir: string): Promise<void> {
  const archive = join(configDir, "retired-messaging-tools");
  for (const name of ["opencode_router_send.ts", "opencode_router_status.ts"]) {
    await mkdir(archive, { recursive: true });
    try {
      await rename(
        join(configDir, "tools", name),
        join(archive, `${name}.${randomUUID()}.disabled`),
      );
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}
