/**
 * MCP Client
 *
 * High-level client for interacting with MCP servers.
 * Wraps protocol layer to provide tool discovery, invocation,
 * resource access, and prompt retrieval.
 */

import {
  MCP_METHODS,
  ToolDefinition,
  ToolCallParams,
  ToolCallResult,
  ToolsListResult,
  ResourceDefinition,
  ResourceContent,
  ResourcesListResult,
  ResourceReadResult,
  PromptDefinition,
  PromptsListResult,
  PromptGetResult,
  PromptMessage,
  ServerCapabilities,
  ServerInfo,
  ClientInfo,
  ClientCapabilities,
} from './types';
import { MCPProtocol } from './protocol';
import { StdioTransport, Transport, TransportOptions } from './transport';

export interface MCPClientOptions {
  clientInfo?: ClientInfo;
  clientCapabilities?: ClientCapabilities;
  timeout?: number;
}

const DEFAULT_CLIENT_INFO: ClientInfo = {
  name: 'golem-mcp',
  version: '0.1.0',
};

export class MCPClient {
  private protocol: MCPProtocol | null = null;
  private transport: Transport | null = null;
  private serverCapabilities: ServerCapabilities | null = null;
  private serverInfo: ServerInfo | null = null;
  private cachedTools: ToolDefinition[] | null = null;
  private readonly clientInfo: ClientInfo;
  private readonly clientCapabilities: ClientCapabilities;
  private readonly timeout: number;

  constructor(options: MCPClientOptions = {}) {
    this.clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
    this.clientCapabilities = options.clientCapabilities ?? {};
    this.timeout = options.timeout ?? 30_000;
  }

  get isConnected(): boolean {
    return this.protocol?.isInitialized ?? false;
  }

  get capabilities(): ServerCapabilities | null {
    return this.serverCapabilities;
  }

  get server(): ServerInfo | null {
    return this.serverInfo;
  }

  /**
   * Connect to an MCP server via stdio transport.
   */
  async connect(transportOptions: TransportOptions): Promise<void> {
    if (this.isConnected) {
      throw new Error('Client already connected');
    }

    this.transport = new StdioTransport({
      ...transportOptions,
      timeout: transportOptions.timeout ?? this.timeout,
    });

    await this.transport.start();

    this.protocol = new MCPProtocol(this.transport, { timeout: this.timeout });

    const result = await this.protocol.initialize(this.clientInfo, this.clientCapabilities);

    this.serverCapabilities = result.capabilities;
    this.serverInfo = result.serverInfo;
  }

  /**
   * Connect using a pre-created transport (useful for testing).
   */
  async connectWithTransport(transport: Transport): Promise<void> {
    if (this.isConnected) {
      throw new Error('Client already connected');
    }

    this.transport = transport;
    this.protocol = new MCPProtocol(transport, { timeout: this.timeout });

    const result = await this.protocol.initialize(this.clientInfo, this.clientCapabilities);

    this.serverCapabilities = result.capabilities;
    this.serverInfo = result.serverInfo;
  }

  /**
   * Disconnect from the server.
   */
  async disconnect(): Promise<void> {
    if (this.protocol) {
      await this.protocol.shutdown();
    }
    if (this.transport) {
      await this.transport.close();
    }
    this.protocol = null;
    this.transport = null;
    this.serverCapabilities = null;
    this.serverInfo = null;
    this.cachedTools = null;
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  async listTools(cursor?: string): Promise<ToolsListResult> {
    this.ensureConnected();
    const params: Record<string, unknown> = {};
    if (cursor) params.cursor = cursor;

    const result = await this.protocol!.request<ToolsListResult>(MCP_METHODS.TOOLS_LIST, params);
    this.cachedTools = result.tools;
    return result;
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    this.ensureConnected();
    const params: ToolCallParams = { name, arguments: args };
    return this.protocol!.request<ToolCallResult>(MCP_METHODS.TOOLS_CALL, params as unknown as Record<string, unknown>);
  }

  /**
   * Get a tool by name from the cached tool list.
   * Fetches the list if not cached.
   */
  async getTool(name: string): Promise<ToolDefinition | undefined> {
    if (!this.cachedTools) {
      await this.listTools();
    }
    return this.cachedTools?.find((t) => t.name === name);
  }

  // ---------------------------------------------------------------------------
  // Resources
  // ---------------------------------------------------------------------------

  async listResources(cursor?: string): Promise<ResourcesListResult> {
    this.ensureConnected();
    const params: Record<string, unknown> = {};
    if (cursor) params.cursor = cursor;

    return this.protocol!.request<ResourcesListResult>(MCP_METHODS.RESOURCES_LIST, params);
  }

  async readResource(uri: string): Promise<ResourceReadResult> {
    this.ensureConnected();
    return this.protocol!.request<ResourceReadResult>(MCP_METHODS.RESOURCES_READ, { uri });
  }

  // ---------------------------------------------------------------------------
  // Prompts
  // ---------------------------------------------------------------------------

  async listPrompts(cursor?: string): Promise<PromptsListResult> {
    this.ensureConnected();
    const params: Record<string, unknown> = {};
    if (cursor) params.cursor = cursor;

    return this.protocol!.request<PromptsListResult>(MCP_METHODS.PROMPTS_LIST, params);
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<PromptGetResult> {
    this.ensureConnected();
    const params: Record<string, unknown> = { name };
    if (args) params.arguments = args;

    return this.protocol!.request<PromptGetResult>(MCP_METHODS.PROMPTS_GET, params);
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------

  onNotification(method: string, handler: (params: Record<string, unknown>) => void): void {
    this.protocol?.onNotification(method, handler);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private ensureConnected(): void {
    if (!this.protocol?.isInitialized) {
      throw new Error('Client not connected. Call connect() first.');
    }
  }
}
