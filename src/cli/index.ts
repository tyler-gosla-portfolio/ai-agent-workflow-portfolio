#!/usr/bin/env node
/**
 * Golem CLI Entry Point
 *
 * Main entry for the `golem` command.
 * Routes to MCP subcommands.
 */

import { createCommandContext, dispatchMcpCommand } from './mcp-commands';

const VERSION = '0.1.0';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return;
  }

  if (args[0] === '--version' || args[0] === '-v') {
    console.log(`golem ${VERSION}`);
    return;
  }

  const command = args[0];

  switch (command) {
    case 'mcp': {
      const ctx = createCommandContext();
      await dispatchMcpCommand(ctx, args.slice(1));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exitCode = 1;
      break;
  }
}

function printUsage(): void {
  console.log(`
golem - AI Agent Workflow CLI

Usage: golem <command> [options]

Commands:
  mcp    Manage MCP server connections, tools, and invocations

Options:
  -h, --help     Show help
  -v, --version  Show version

Run "golem mcp --help" for MCP subcommand details.
  `.trim());
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
