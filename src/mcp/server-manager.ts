/**
 * Server Lifecycle Manager
 *
 * Manages the lifecycle of MCP server processes: start, stop, restart, list.
 * Each server gets its own MCPClient connection over stdio transport.
 */

import { EventEmitter } from 'events';
import {
  ServerConfig,
  ServerState,
  ServerStatus,
  ServerCapabilities,
  ServerInfo,
} from './types';
import { MCPClient, MCPClientOptions } from './client';

export interface ManagedServer {
  config: ServerConfig;
  client: MCPClient;
  state: ServerState;
}

export class ServerManager {
  private servers = new Map<string, ManagedServer>();
  private emitter = new EventEmitter();

  constructor(private readonly clientOptions?: MCPClientOptions) {}

  /**
   * Start an MCP server by its config.
   * Spawns the process, connects the client, and performs the initialize handshake.
   */
  async start(config: ServerConfig): Promise<ServerState> {
    if (this.servers.has(config.name)) {
      const existing = this.servers.get(config.name)!;
      if (existing.state.status === 'running') {
        throw new Error(`Server "${config.name}" is already running`);
      }
      // Clean up stale entry
      await this.stopInternal(config.name);
    }

    const client = new MCPClient(this.clientOptions);

    const state: ServerState = {
      name: config.name,
      status: 'starting',
    };

    const managed: ManagedServer = { config, client, state };
    this.servers.set(config.name, managed);
    this.emitStateChange(config.name, state);

    try {
      await client.connect({
        command: config.command,
        args: config.args,
        env: config.env,
      });

      state.status = 'running';
      state.capabilities = client.capabilities ?? undefined;
      state.serverInfo = client.server ?? undefined;
      state.startedAt = new Date();

      // Fetch tool count
      try {
        const tools = await client.listTools();
        state.toolCount = tools.tools.length;
      } catch {
        state.toolCount = 0;
      }

      this.emitStateChange(config.name, state);
      return { ...state };
    } catch (err) {
      state.status = 'error';
      state.error = err instanceof Error ? err.message : String(err);
      // Clean up the failed entry so stopAll doesn't hang
      this.servers.delete(config.name);
      this.emitStateChange(config.name, state);
      throw err;
    }
  }

  /**
   * Stop a running MCP server.
   */
  async stop(name: string): Promise<void> {
    const managed = this.servers.get(name);
    if (!managed) {
      throw new Error(`Server "${name}" not found`);
    }
    await this.stopInternal(name);
  }

  /**
   * Restart a server (stop then start with same config).
   */
  async restart(name: string): Promise<ServerState> {
    const managed = this.servers.get(name);
    if (!managed) {
      throw new Error(`Server "${name}" not found`);
    }
    const config = managed.config;
    await this.stopInternal(name);
    return this.start(config);
  }

  /**
   * List all managed servers and their states.
   */
  list(): ServerState[] {
    return Array.from(this.servers.values()).map((m) => ({ ...m.state }));
  }

  /**
   * Get a specific server's state.
   */
  get(name: string): ServerState | undefined {
    const managed = this.servers.get(name);
    return managed ? { ...managed.state } : undefined;
  }

  /**
   * Get the MCPClient for a running server.
   */
  getClient(name: string): MCPClient | undefined {
    const managed = this.servers.get(name);
    if (managed?.state.status === 'running') {
      return managed.client;
    }
    return undefined;
  }

  /**
   * Stop all servers.
   */
  async stopAll(): Promise<void> {
    const names = Array.from(this.servers.keys());
    await Promise.all(names.map((name) => this.stopInternal(name)));
  }

  /**
   * Start multiple servers from configs.
   * Servers with autoStart: false are registered but not started.
   */
  async startAll(configs: ServerConfig[]): Promise<Map<string, ServerState>> {
    const results = new Map<string, ServerState>();

    for (const config of configs) {
      if (config.autoStart === false) {
        // Register but don't start
        const state: ServerState = { name: config.name, status: 'stopped' };
        const client = new MCPClient(this.clientOptions);
        this.servers.set(config.name, { config, client, state });
        results.set(config.name, { ...state });
        continue;
      }

      try {
        const state = await this.start(config);
        results.set(config.name, state);
      } catch (err) {
        results.set(config.name, {
          name: config.name,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * Register for server state change events.
   */
  onStateChange(handler: (name: string, state: ServerState) => void): void {
    this.emitter.on('stateChange', handler);
  }

  private async stopInternal(name: string): Promise<void> {
    const managed = this.servers.get(name);
    if (!managed) return;

    try {
      await managed.client.disconnect();
    } catch {
      // Best-effort disconnect
    }

    managed.state.status = 'stopped';
    managed.state.startedAt = undefined;
    managed.state.capabilities = undefined;
    managed.state.serverInfo = undefined;
    managed.state.toolCount = undefined;
    managed.state.error = undefined;

    this.servers.delete(name);
    this.emitStateChange(name, managed.state);
  }

  private emitStateChange(name: string, state: ServerState): void {
    this.emitter.emit('stateChange', name, { ...state });
  }
}
