#!/usr/bin/env node
import { runCli } from "../src/cli.ts";

const result = runCli(process.argv.slice(2));
process.stdout.write(result.out + "\n");
// Let Node drain piped stdout before exiting, including nonzero read results.
process.exitCode = result.code;
