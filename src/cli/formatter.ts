/**
 * CLI Output Formatter
 *
 * Structured terminal output for server states, tool lists,
 * and invocation results.
 */

import {
  ServerState,
  ToolDefinition,
  ToolCallResult,
} from '../mcp/types';
import { AuditEntry } from '../mcp/security';

const STATUS_ICONS: Record<string, string> = {
  running: '[OK]',
  stopped: '[--]',
  starting: '[..]',
  error: '[!!]',
};

export function formatServerState(state: ServerState): string {
  const icon = STATUS_ICONS[state.status] || '[??]';
  const parts = [`${icon} ${state.name}`, `status=${state.status}`];

  if (state.serverInfo) {
    parts.push(`server=${state.serverInfo.name}@${state.serverInfo.version}`);
  }
  if (state.toolCount !== undefined) {
    parts.push(`tools=${state.toolCount}`);
  }
  if (state.pid) {
    parts.push(`pid=${state.pid}`);
  }
  if (state.startedAt) {
    parts.push(`started=${state.startedAt.toISOString()}`);
  }
  if (state.error) {
    parts.push(`error="${state.error}"`);
  }

  return parts.join('  ');
}

export function formatServerList(states: ServerState[]): string {
  if (states.length === 0) {
    return 'No servers registered.';
  }

  const lines = ['MCP Servers:', ''];
  for (const state of states) {
    lines.push('  ' + formatServerState(state));
  }
  return lines.join('\n');
}

export function formatToolList(tools: Array<{ server: string; tool: ToolDefinition }>): string {
  if (tools.length === 0) {
    return 'No tools available.';
  }

  const lines = ['Available Tools:', ''];
  let currentServer = '';

  for (const { server, tool } of tools) {
    if (server !== currentServer) {
      if (currentServer) lines.push('');
      lines.push(`  [${server}]`);
      currentServer = server;
    }

    const desc = tool.description ? ` - ${tool.description}` : '';
    lines.push(`    ${tool.name}${desc}`);

    if (tool.inputSchema?.properties) {
      const params = Object.entries(tool.inputSchema.properties);
      for (const [name, prop] of params) {
        const required = tool.inputSchema.required?.includes(name) ? ' (required)' : '';
        lines.push(`      ${name}: ${prop.type}${required}`);
      }
    }
  }

  return lines.join('\n');
}

export function formatToolResult(result: ToolCallResult, durationMs?: number): string {
  const lines: string[] = [];

  if (result.isError) {
    lines.push('Error:');
  }

  for (const content of result.content) {
    if (content.type === 'text' && content.text) {
      lines.push(content.text);
    } else if (content.type === 'image') {
      lines.push(`[image: ${content.mimeType || 'unknown type'}]`);
    } else if (content.type === 'resource') {
      lines.push(`[resource]`);
    }
  }

  if (durationMs !== undefined) {
    lines.push(`\n(${durationMs}ms)`);
  }

  return lines.join('\n');
}

export function formatAuditLog(entries: AuditEntry[]): string {
  if (entries.length === 0) {
    return 'No audit entries.';
  }

  const lines = ['Audit Log:', ''];
  for (const entry of entries) {
    const parts = [
      entry.timestamp,
      entry.action.toUpperCase().padEnd(6),
      `${entry.server}.${entry.tool}`,
    ];
    if (entry.result) parts.push(`result=${entry.result}`);
    if (entry.durationMs !== undefined) parts.push(`${entry.durationMs}ms`);
    if (entry.reason) parts.push(`reason="${entry.reason}"`);
    lines.push('  ' + parts.join('  '));
  }

  return lines.join('\n');
}

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Error: ${String(err)}`;
}

export function formatJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
