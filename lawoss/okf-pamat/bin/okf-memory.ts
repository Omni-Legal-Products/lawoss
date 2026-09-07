#!/usr/bin/env node
import { runCli } from "../src/cli.ts";

const result = runCli(process.argv.slice(2));
process.stdout.write(result.out + "\n");
process.exit(result.code);
