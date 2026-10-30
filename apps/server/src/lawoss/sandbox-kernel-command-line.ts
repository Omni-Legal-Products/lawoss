import type { Accelerator } from "../agent-sandbox/acceleration.js";

/** Guest kernel arguments for the sandbox VM. Under x86 software emulation
 * (tcg) the kernel's boot-time IO-APIC timer check can miss its window and
 * panic ("IO-APIC + timer doesn't work!"); no_timer_check skips that check,
 * as common VM images do. Hardware-accelerated and ARM guests are unchanged. */
export function sandboxKernelCommandLine(input: { arm: boolean; accelerator: Accelerator; directNetwork: boolean }): string {
  return `rdinit=/init panic=1 quiet console=${input.arm ? "ttyAMA0" : "ttyS0"}${input.directNetwork ? " legalwork.network=allow" : ""}` +
    (!input.arm && input.accelerator === "tcg" ? " no_timer_check" : "");
}
