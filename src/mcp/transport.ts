/**
 * Stdio Transport
 *
 * Manages a child process that communicates via JSON-RPC over stdin/stdout.
 * Handles message framing, buffering, and process lifecycle.
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { JsonRpcMessage, JsonRpcResponse } from './types';

export interface TransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number; // ms, default 30000
}

export interface Transport {
  start(): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  close(): Promise<void>;
  onMessage(handler: (msg: JsonRpcMessage) => void): void;
  onError(handler: (err: Error) => void): void;
  onClose(handler: (code: number | null) => void): void;
  readonly isConnected: boolean;
}

export class StdioTransport implements Transport {
  private process: ChildProcess | null = null;
  private emitter = new EventEmitter();
  private buffer = '';
  private _isConnected = false;
  private readonly options: Required<TransportOptions>;

  constructor(options: TransportOptions) {
    this.options = {
      args: [],
      env: {},
      timeout: 30_000,
      ...options,
    };
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  async start(): Promise<void> {
    if (this._isConnected) {
      throw new Error('Transport already started');
    }

    const mergedEnv = { ...process.env, ...this.options.env };

    this.process = spawn(this.options.command, this.options.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: mergedEnv,
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.handleData(chunk.toString('utf-8'));
    });

    this.process.stderr!.on('data', (chunk: Buffer) => {
      this.emitter.emit('error', new Error(`stderr: ${chunk.toString('utf-8').trim()}`));
    });

    this.process.on('close', (code) => {
      this._isConnected = false;
      this.emitter.emit('close', code);
    });

    this.process.on('error', (err) => {
      this._isConnected = false;
      this.emitter.emit('error', err);
    });

    // Wait for the process to be ready: race spawn vs error/close
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      // Fallback timeout in case neither spawn nor error fires
      const timer = setTimeout(() => {
        settle(() => {
          this._isConnected = true;
          resolve();
        });
      }, 2000);

      this.process!.on('spawn', () => {
        clearTimeout(timer);
        settle(() => {
          this._isConnected = true;
          resolve();
        });
      });

      this.process!.on('error', (err) => {
        clearTimeout(timer);
        settle(() => reject(err));
      });

      this.process!.on('close', (code) => {
        clearTimeout(timer);
        settle(() => {
          if (!this._isConnected) {
            reject(new Error(`Process exited immediately with code ${code}`));
          }
        });
      });
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this._isConnected || !this.process?.stdin?.writable) {
      throw new Error('Transport not connected');
    }

    const payload = JSON.stringify(message) + '\n';

    return new Promise((resolve, reject) => {
      this.process!.stdin!.write(payload, 'utf-8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.process) return;

    this._isConnected = false;

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.process?.kill('SIGKILL');
        resolve();
      }, 5_000);

      this.process!.on('close', () => {
        clearTimeout(timer);
        resolve();
      });

      this.process!.stdin?.end();
      this.process!.kill('SIGTERM');
    });
  }

  onMessage(handler: (msg: JsonRpcMessage) => void): void {
    this.emitter.on('message', handler);
  }

  onError(handler: (err: Error) => void): void {
    this.emitter.on('error', handler);
  }

  onClose(handler: (code: number | null) => void): void {
    this.emitter.on('close', handler);
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    // Keep the last (possibly incomplete) chunk
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as JsonRpcMessage;
        this.emitter.emit('message', parsed);
      } catch {
        this.emitter.emit('error', new Error(`Failed to parse JSON-RPC message: ${trimmed.slice(0, 200)}`));
      }
    }
  }

  /** Expose PID for server tracking */
  get pid(): number | undefined {
    return this.process?.pid;
  }
}

/**
 * Send a request and wait for its matching response.
 * Handles timeout and error responses.
 */
export function sendRequest(
  transport: Transport,
  message: JsonRpcMessage & { id: number | string; method: string },
  timeoutMs = 30_000,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Request ${message.method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (msg: JsonRpcMessage) => {
      if ('id' in msg && msg.id === message.id) {
        cleanup();
        resolve(msg as JsonRpcResponse);
      }
    };

    const errorHandler = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      transport.onMessage(() => {}); // noop - EventEmitter doesn't have removeListener on interface
    };

    // We need direct EventEmitter access for proper cleanup
    // The handler stays registered but checks message ID, so stale handlers are harmless
    transport.onMessage(handler);
    transport.onError(errorHandler);
    transport.send(message).catch(reject);
  });
}
