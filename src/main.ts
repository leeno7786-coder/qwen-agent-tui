#!/usr/bin/env bun
/**
 * Entry point: headless subcommands for agents, TUI for interactive use.
 *
 *   qwen-agent              → TUI
 *   qwen-agent tui          → TUI
 *   qwen-agent run --prompt "…"
 *   qwen-agent models|doctor
 */

import { runCli } from "./cli/index";
import { printRootHelp } from "./cli/help";

async function main(): Promise<number> {
  try {
    const argv = process.argv.slice(2);

    if (argv.length === 0) {
      const { runTui } = await import("./opentui/index");
      await runTui();
      return 0;
    }

    const [cmd] = argv;

    if (cmd === "--help" || cmd === "-h") {
      printRootHelp();
      return 0;
    }

    if (cmd === "tui") {
      const { runTui } = await import("./opentui/index");
      await runTui();
      return 0;
    }

    return await runCli(argv);
  } catch (err) {
    // Handle any synchronous or asynchronous errors from main
    console.error("Unhandled error in main:", err instanceof Error ? err.message : String(err));
    return 1;
  }
}

main()
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
