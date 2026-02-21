/**
 * @golem/mcp - MCP Server Integration
 *
 * Programmatic API for managing MCP servers, discovering tools,
 * and routing tool invocations.
 */

export { MCPClient } from './mcp/client';
export type { MCPClientOptions } from './mcp/client';

export { MCPProtocol, MCPError } from './mcp/protocol';
export { StdioTransport, sendRequest } from './mcp/transport';
export type { Transport, TransportOptions } from './mcp/transport';

export { ServerManager } from './mcp/server-manager';
export type { ManagedServer } from './mcp/server-manager';

export { ManifestManager, loadServerConfigs } from './mcp/manifest';
export { PermissionGuard, SecretProvider, AuditLog } from './mcp/security';
export { ToolRouter } from './mcp/router';
export type { RouteResult } from './mcp/router';

export * from './mcp/types';
