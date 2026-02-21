/**
 * MCP Protocol Layer
 *
 * Manages JSON-RPC 2.0 message framing, request ID tracking,
 * and the MCP initialize/shutdown handshake.
 */

import { EventEmitter } from 'events';
import {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  JSONRPC_ERRORS,
  MCP_PROTOCOL_VERSION,
  MCP_METHODS,
  InitializeParams,
  InitializeResult,
  ClientInfo,
  ClientCapabilities,
} from './types';
import { Transport } from './transport';

export interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export class MCPProtocol {
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private emitter = new EventEmitter();
  private initialized = false;
  private readonly timeout: number;

  constructor(
    private readonly transport: Transport,
    options?: { timeout?: number },
  ) {
    this.timeout = options?.timeout ?? 30_000;
    this.transport.onMessage((msg) => this.handleMessage(msg));
    this.transport.onClose((code) => this.handleClose(code));
    this.transport.onError((err) => this.emitter.emit('error', err));
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Perform the MCP initialize handshake.
   * Sends initialize request, waits for result, then sends initialized notification.
   */
  async initialize(clientInfo: ClientInfo, capabilities: ClientCapabilities = {}): Promise<InitializeResult> {
    const params: InitializeParams = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities,
      clientInfo,
    };

    const result = await this.request<InitializeResult>(MCP_METHODS.INITIALIZE, params as unknown as Record<string, unknown>);

    // Send the initialized notification to complete handshake
    await this.notify(MCP_METHODS.INITIALIZED);
    this.initialized = true;

    return result;
  }

  /**
   * Send a JSON-RPC request and await its response.
   */
  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;

    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined && { params }),
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
        method,
      });

      this.transport.send(message).catch((err) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined && { params }),
    };

    await this.transport.send(message);
  }

  /**
   * Register a handler for server-initiated notifications.
   */
  onNotification(method: string, handler: (params: Record<string, unknown>) => void): void {
    this.emitter.on(`notification:${method}`, handler);
  }

  /**
   * Register a handler for protocol errors.
   */
  onError(handler: (err: Error) => void): void {
    this.emitter.on('error', handler);
  }

  /**
   * Register a handler for connection close.
   */
  onClose(handler: (code: number | null) => void): void {
    this.emitter.on('close', handler);
  }

  /**
   * Clean shutdown: send shutdown request, then close transport.
   */
  async shutdown(): Promise<void> {
    if (this.initialized) {
      try {
        await this.request(MCP_METHODS.SHUTDOWN);
      } catch {
        // Best-effort shutdown
      }
      this.initialized = false;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Protocol shutting down'));
      this.pending.delete(id);
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    // Response to a pending request
    if ('id' in msg && msg.id !== undefined && msg.id !== null) {
      const response = msg as JsonRpcResponse;
      const pending = this.pending.get(response.id);
      if (pending) {
        this.pending.delete(response.id);
        clearTimeout(pending.timer);

        if (response.error) {
          pending.reject(new MCPError(response.error));
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Server-initiated notification
    if ('method' in msg && !('id' in msg)) {
      const notification = msg as JsonRpcNotification;
      this.emitter.emit(`notification:${notification.method}`, notification.params || {});
      return;
    }
  }

  private handleClose(code: number | null): void {
    this.initialized = false;

    // Reject all pending
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Transport closed with code ${code}`));
      this.pending.delete(id);
    }

    this.emitter.emit('close', code);
  }
}

export class MCPError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(rpcError: JsonRpcError) {
    super(rpcError.message);
    this.name = 'MCPError';
    this.code = rpcError.code;
    this.data = rpcError.data;
  }
}
