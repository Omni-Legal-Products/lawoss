import { describe, expect, test } from "bun:test";

import { sandboxKernelCommandLine } from "./sandbox-kernel-command-line.js";

describe("sandbox guest kernel command line", () => {
  test("x86 software emulation skips the IO-APIC timer check that panics under slow tcg", () => {
    expect(sandboxKernelCommandLine({ arm: false, accelerator: "tcg", directNetwork: false }))
      .toBe("rdinit=/init panic=1 quiet console=ttyS0 no_timer_check");
  });

  test("hardware acceleration and ARM keep the original arguments", () => {
    expect(sandboxKernelCommandLine({ arm: false, accelerator: "hvf", directNetwork: false }))
      .toBe("rdinit=/init panic=1 quiet console=ttyS0");
    expect(sandboxKernelCommandLine({ arm: false, accelerator: "whpx", directNetwork: true }))
      .toBe("rdinit=/init panic=1 quiet console=ttyS0 legalwork.network=allow");
    expect(sandboxKernelCommandLine({ arm: true, accelerator: "tcg", directNetwork: true }))
      .toBe("rdinit=/init panic=1 quiet console=ttyAMA0 legalwork.network=allow");
  });

  test("x86 tcg with direct network keeps the network flag", () => {
    expect(sandboxKernelCommandLine({ arm: false, accelerator: "tcg", directNetwork: true }))
      .toBe("rdinit=/init panic=1 quiet console=ttyS0 legalwork.network=allow no_timer_check");
  });
});
