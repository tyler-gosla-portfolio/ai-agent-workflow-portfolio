/**
 * Tool Invocation Router
 *
 * Routes tool calls to the correct MCP server, applying permission
 * checks and audit logging. Supports qualified names (server.tool)
 * and unqualified names (searches all servers).
 */

import { ServerManager } from './server-manager';
import { ManifestManager } from './manifest';
import { PermissionGuard, AuditLog } from './security';
import { ToolCallResult, ToolDefinition } from './types';

export interface RouteResult {
  server: string;
  tool: string;
  result: ToolCallResult;
  durationMs: number;
}

export class ToolRouter {
  constructor(
    private readonly serverManager: ServerManager,
    private readonly manifest: ManifestManager,
    private readonly guard: PermissionGuard,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Route a tool call to the appropriate server.
   *
   * @param qualifiedName - "server.tool" or just "tool" (searches all)
   * @param args - tool arguments
   */
  async invoke(qualifiedName: string, args?: Record<string, unknown>): Promise<RouteResult> {
    // Resolve which server and tool name
    const resolved = this.resolveToolName(qualifiedName);
    if (!resolved) {
      throw new Error(`Tool "${qualifiedName}" not found in any registered server`);
    }

    const { server, toolName } = resolved;

    // Permission check
    const perm = this.guard.checkToolPermission(toolName);
    if (!perm.allowed) {
      this.audit.logDenial(server, toolName, perm.reason!);
      throw new Error(`Permission denied: ${perm.reason}`);
    }

    // Get the client for this server
    const client = this.serverManager.getClient(server);
    if (!client) {
      throw new Error(`Server "${server}" is not running`);
    }

    // Invoke the tool
    const start = Date.now();
    try {
      const result = await client.callTool(toolName, args);
      const durationMs = Date.now() - start;

      this.audit.logInvocation(server, toolName, args, result.isError ? 'failure' : 'success', durationMs);

      return { server, tool: toolName, result, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      this.audit.logInvocation(server, toolName, args, 'failure', durationMs);
      throw err;
    }
  }

  /**
   * List all available tools across all running servers.
   */
  async listAllTools(): Promise<Array<{ server: string; tool: ToolDefinition }>> {
    const result: Array<{ server: string; tool: ToolDefinition }> = [];

    for (const state of this.serverManager.list()) {
      if (state.status !== 'running') continue;

      const client = this.serverManager.getClient(state.name);
      if (!client) continue;

      try {
        const tools = await client.listTools();
        for (const tool of tools.tools) {
          result.push({ server: state.name, tool });
        }

        // Update manifest cache
        this.manifest.updateTools(state.name, tools.tools);
      } catch {
        // Skip servers that fail to list tools
      }
    }

    return result;
  }

  /**
   * Resolve a tool name to its server and bare tool name.
   */
  private resolveToolName(qualifiedName: string): { server: string; toolName: string } | null {
    const dotIndex = qualifiedName.indexOf('.');

    if (dotIndex !== -1) {
      // Qualified: "server.tool"
      const server = qualifiedName.slice(0, dotIndex);
      const toolName = qualifiedName.slice(dotIndex + 1);
      return { server, toolName };
    }

    // Unqualified: search manifest
    const found = this.manifest.findTool(qualifiedName);
    if (found) {
      return { server: found.server, toolName: found.tool.name };
    }

    // Fallback: check running servers
    for (const state of this.serverManager.list()) {
      if (state.status === 'running') {
        return { server: state.name, toolName: qualifiedName };
      }
    }

    return null;
  }
}
