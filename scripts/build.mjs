import { execSync } from "node:child_process";

execSync("pnpm --filter @legalwork/desktop build", { stdio: "inherit" });
