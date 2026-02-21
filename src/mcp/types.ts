/**
 * MCP Protocol Types
 *
 * Complete type definitions for the Model Context Protocol (MCP).
 * Based on JSON-RPC 2.0 transport with MCP-specific message schemas
 * for tool discovery, invocation, resource access, and lifecycle management.
 */

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 Base Types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// Standard JSON-RPC error codes
export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ---------------------------------------------------------------------------
// MCP Protocol Constants
// ---------------------------------------------------------------------------

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export const MCP_METHODS = {
  // Lifecycle
  INITIALIZE: 'initialize',
  INITIALIZED: 'notifications/initialized',
  SHUTDOWN: 'shutdown',

  // Tools
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',

  // Resources
  RESOURCES_LIST: 'resources/list',
  RESOURCES_READ: 'resources/read',

  // Prompts
  PROMPTS_LIST: 'prompts/list',
  PROMPTS_GET: 'prompts/get',

  // Logging
  LOG: 'notifications/message',
} as const;

// ---------------------------------------------------------------------------
// MCP Capability Types
// ---------------------------------------------------------------------------

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, never>;
}

export interface ClientCapabilities {
  roots?: { listChanged?: boolean };
  sampling?: Record<string, never>;
}

export interface ServerInfo {
  name: string;
  version: string;
}

export interface ClientInfo {
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Initialize Handshake
// ---------------------------------------------------------------------------

export interface InitializeParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: ClientInfo;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: ServerInfo;
}

// ---------------------------------------------------------------------------
// Tool Types
// ---------------------------------------------------------------------------

export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: ToolInputSchema;
}

export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolCallContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolCallResult {
  content: ToolCallContent[];
  isError?: boolean;
}

export interface ToolsListResult {
  tools: ToolDefinition[];
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Resource Types
// ---------------------------------------------------------------------------

export interface ResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface ResourcesListResult {
  resources: ResourceDefinition[];
  nextCursor?: string;
}

export interface ResourceReadResult {
  contents: ResourceContent[];
}

// ---------------------------------------------------------------------------
// Prompt Types
// ---------------------------------------------------------------------------

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
}

export interface PromptsListResult {
  prompts: PromptDefinition[];
  nextCursor?: string;
}

export interface PromptGetResult {
  description?: string;
  messages: PromptMessage[];
}

// ---------------------------------------------------------------------------
// Server Configuration
// ---------------------------------------------------------------------------

export type TransportType = 'stdio' | 'http';

export interface ServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport: TransportType;
  autoStart?: boolean;
  permissions?: ToolPermission[];
}

export interface ToolPermission {
  tool: string;        // glob pattern, e.g. "file_*" or "*"
  allow: boolean;
  scopes?: PermissionScope[];
}

export type PermissionScope = 'read' | 'write' | 'execute' | 'network';

// ---------------------------------------------------------------------------
// Server State
// ---------------------------------------------------------------------------

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ServerState {
  name: string;
  status: ServerStatus;
  pid?: number;
  capabilities?: ServerCapabilities;
  serverInfo?: ServerInfo;
  toolCount?: number;
  startedAt?: Date;
  error?: string;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface ServerManifestEntry {
  config: ServerConfig;
  capabilities?: ServerCapabilities;
  tools?: ToolDefinition[];
  resources?: ResourceDefinition[];
  prompts?: PromptDefinition[];
  lastDiscovered?: Date;
}

export interface GolemManifest {
  version: string;
  servers: Record<string, ServerManifestEntry>;
}
