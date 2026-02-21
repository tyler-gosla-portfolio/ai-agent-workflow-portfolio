/**
 * CLI Command Handlers - golem mcp *
 *
 * All subcommands for the `golem mcp` command group:
 *   golem mcp start <name>     - Start a server
 *   golem mcp stop <name>      - Stop a server
 *   golem mcp restart <name>   - Restart a server
 *   golem mcp list             - List servers
 *   golem mcp tools [server]   - List tools
 *   golem mcp call <tool> [...args] - Call a tool
 *   golem mcp add <name> <cmd> - Add a server to manifest
 *   golem mcp remove <name>    - Remove a server from manifest
 *   golem mcp audit [server]   - Show audit log
 */

import { ServerManager } from '../mcp/server-manager';
import { ManifestManager, loadServerConfigs } from '../mcp/manifest';
import { PermissionGuard, AuditLog, SecretProvider } from '../mcp/security';
import { ToolRouter } from '../mcp/router';
import { ServerConfig } from '../mcp/types';
import {
  formatServerList,
  formatServerState,
  formatToolList,
  formatToolResult,
  formatAuditLog,
  formatError,
  formatJSON,
} from './formatter';

export interface CommandContext {
  serverManager: ServerManager;
  manifest: ManifestManager;
  guard: PermissionGuard;
  audit: AuditLog;
  secrets: SecretProvider;
  router: ToolRouter;
  output: (msg: string) => void;
}

export function createCommandContext(configPath?: string): CommandContext {
  const serverManager = new ServerManager();
  const manifest = new ManifestManager();
  const guard = new PermissionGuard();
  const audit = new AuditLog();
  const secrets = new SecretProvider();
  const router = new ToolRouter(serverManager, manifest, guard, audit);

  manifest.load();
  secrets.loadFromEnv();

  return {
    serverManager,
    manifest,
    guard,
    audit,
    secrets,
    router,
    output: console.log,
  };
}

// ---------------------------------------------------------------------------
// Server Lifecycle Commands
// ---------------------------------------------------------------------------

export async function cmdStart(ctx: CommandContext, name: string): Promise<void> {
  const entry = ctx.manifest.getServer(name);
  if (!entry) {
    ctx.output(formatError(new Error(`Server "${name}" not found in manifest. Use "golem mcp add" first.`)));
    return;
  }

  // Server allowlist check
  const allowed = ctx.guard.isServerAllowed(name);
  if (!allowed.allowed) {
    ctx.output(formatError(new Error(allowed.reason!)));
    return;
  }

  try {
    const env = ctx.secrets.buildEnv(entry.config);
    const config = { ...entry.config, env: { ...entry.config.env, ...env } };

    ctx.output(`Starting server "${name}"...`);
    const state = await ctx.serverManager.start(config);

    // Update manifest with discovered capabilities
    if (state.capabilities) {
      ctx.manifest.updateCapabilities(name, state.capabilities);
    }

    // Discover and cache tools
    const client = ctx.serverManager.getClient(name);
    if (client) {
      try {
        const tools = await client.listTools();
        ctx.manifest.updateTools(name, tools.tools);
      } catch {
        // Non-fatal
      }
    }

    ctx.manifest.save();
    ctx.output(formatServerState(state));
  } catch (err) {
    ctx.output(formatError(err));
  }
}

export async function cmdStop(ctx: CommandContext, name: string): Promise<void> {
  try {
    await ctx.serverManager.stop(name);
    ctx.output(`Server "${name}" stopped.`);
  } catch (err) {
    ctx.output(formatError(err));
  }
}

export async function cmdRestart(ctx: CommandContext, name: string): Promise<void> {
  try {
    ctx.output(`Restarting server "${name}"...`);
    const state = await ctx.serverManager.restart(name);
    ctx.output(formatServerState(state));
  } catch (err) {
    ctx.output(formatError(err));
  }
}

export async function cmdList(ctx: CommandContext): Promise<void> {
  const states = ctx.serverManager.list();

  // Include manifest-only servers that aren't running
  const manifestServers = ctx.manifest.listServers();
  for (const config of manifestServers) {
    if (!states.find((s) => s.name === config.name)) {
      states.push({ name: config.name, status: 'stopped' });
    }
  }

  ctx.output(formatServerList(states));
}

// ---------------------------------------------------------------------------
// Tool Commands
// ---------------------------------------------------------------------------

export async function cmdTools(ctx: CommandContext, serverName?: string): Promise<void> {
  try {
    if (serverName) {
      const client = ctx.serverManager.getClient(serverName);
      if (!client) {
        // Try manifest cache
        const entry = ctx.manifest.getServer(serverName);
        if (entry?.tools) {
          ctx.output(formatToolList(entry.tools.map((t) => ({ server: serverName, tool: t }))));
          return;
        }
        ctx.output(formatError(new Error(`Server "${serverName}" is not running and has no cached tools.`)));
        return;
      }

      const tools = await client.listTools();
      ctx.output(formatToolList(tools.tools.map((t) => ({ server: serverName, tool: t }))));
    } else {
      const allTools = await ctx.router.listAllTools();

      // Also include cached tools from non-running servers
      const runningServers = new Set(ctx.serverManager.list().map((s) => s.name));
      for (const config of ctx.manifest.listServers()) {
        if (!runningServers.has(config.name)) {
          const entry = ctx.manifest.getServer(config.name);
          if (entry?.tools) {
            for (const tool of entry.tools) {
              allTools.push({ server: config.name, tool });
            }
          }
        }
      }

      ctx.output(formatToolList(allTools));
    }
  } catch (err) {
    ctx.output(formatError(err));
  }
}

export async function cmdCall(
  ctx: CommandContext,
  toolName: string,
  argsJson?: string,
): Promise<void> {
  try {
    const args = argsJson ? JSON.parse(argsJson) : undefined;
    const routeResult = await ctx.router.invoke(toolName, args);
    ctx.output(formatToolResult(routeResult.result, routeResult.durationMs));
  } catch (err) {
    ctx.output(formatError(err));
  }
}

// ---------------------------------------------------------------------------
// Manifest Commands
// ---------------------------------------------------------------------------

export async function cmdAdd(
  ctx: CommandContext,
  name: string,
  command: string,
  args?: string[],
): Promise<void> {
  const config: ServerConfig = {
    name,
    command,
    args: args ?? [],
    transport: 'stdio',
    autoStart: true,
  };

  ctx.manifest.addServer(config);
  ctx.manifest.save();
  ctx.output(`Server "${name}" added to manifest.`);
}

export async function cmdRemove(ctx: CommandContext, name: string): Promise<void> {
  // Stop if running
  const state = ctx.serverManager.get(name);
  if (state?.status === 'running') {
    await ctx.serverManager.stop(name);
  }

  if (ctx.manifest.removeServer(name)) {
    ctx.manifest.save();
    ctx.output(`Server "${name}" removed from manifest.`);
  } else {
    ctx.output(formatError(new Error(`Server "${name}" not found in manifest.`)));
  }
}

// ---------------------------------------------------------------------------
// Audit Command
// ---------------------------------------------------------------------------

export async function cmdAudit(ctx: CommandContext, serverName?: string): Promise<void> {
  const entries = serverName ? ctx.audit.forServer(serverName) : ctx.audit.recent(100);
  ctx.output(formatAuditLog(entries));
}

// ---------------------------------------------------------------------------
// Command Dispatcher
// ---------------------------------------------------------------------------

export async function dispatchMcpCommand(
  ctx: CommandContext,
  args: string[],
): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'start':
      if (!args[1]) { ctx.output('Usage: golem mcp start <server-name>'); return; }
      await cmdStart(ctx, args[1]);
      break;

    case 'stop':
      if (!args[1]) { ctx.output('Usage: golem mcp stop <server-name>'); return; }
      await cmdStop(ctx, args[1]);
      break;

    case 'restart':
      if (!args[1]) { ctx.output('Usage: golem mcp restart <server-name>'); return; }
      await cmdRestart(ctx, args[1]);
      break;

    case 'list':
    case 'ls':
      await cmdList(ctx);
      break;

    case 'tools':
      await cmdTools(ctx, args[1]);
      break;

    case 'call':
      if (!args[1]) { ctx.output('Usage: golem mcp call <tool-name> [args-json]'); return; }
      await cmdCall(ctx, args[1], args[2]);
      break;

    case 'add':
      if (!args[1] || !args[2]) { ctx.output('Usage: golem mcp add <name> <command> [args...]'); return; }
      await cmdAdd(ctx, args[1], args[2], args.slice(3));
      break;

    case 'remove':
    case 'rm':
      if (!args[1]) { ctx.output('Usage: golem mcp remove <server-name>'); return; }
      await cmdRemove(ctx, args[1]);
      break;

    case 'audit':
      await cmdAudit(ctx, args[1]);
      break;

    default:
      ctx.output(HELP_TEXT);
      break;
  }
}

const HELP_TEXT = `
golem mcp - MCP Server Management

Usage: golem mcp <command> [options]

Commands:
  start <name>                  Start a registered MCP server
  stop <name>                   Stop a running MCP server
  restart <name>                Restart an MCP server
  list                          List all MCP servers and their status
  tools [server]                List available tools (optionally filter by server)
  call <tool> [args-json]       Call a tool (use server.tool or just tool name)
  add <name> <cmd> [args...]    Register a new MCP server
  remove <name>                 Remove a server from the manifest
  audit [server]                Show audit log (optionally filter by server)

Examples:
  golem mcp add myserver npx -y @modelcontextprotocol/server-everything
  golem mcp start myserver
  golem mcp tools myserver
  golem mcp call myserver.echo '{"message": "hello"}'
  golem mcp stop myserver
`.trim();
