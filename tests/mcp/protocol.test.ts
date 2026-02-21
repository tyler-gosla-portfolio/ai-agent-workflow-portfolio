import { MCPProtocol, MCPError } from '../../src/mcp/protocol';
import { Transport } from '../../src/mcp/transport';
import {
  JsonRpcMessage,
  JsonRpcResponse,
  MCP_PROTOCOL_VERSION,
  MCP_METHODS,
  InitializeResult,
} from '../../src/mcp/types';

/**
 * Mock transport for testing the protocol layer in isolation.
 */
class MockTransport implements Transport {
  private messageHandlers: Array<(msg: JsonRpcMessage) => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];
  private closeHandlers: Array<(code: number | null) => void> = [];
  public sentMessages: JsonRpcMessage[] = [];
  private _isConnected = true;

  // Auto-response map: method -> result
  public autoResponses = new Map<string, unknown>();

  get isConnected(): boolean {
    return this._isConnected;
  }

  async start(): Promise<void> {
    this._isConnected = true;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this._isConnected) throw new Error('Not connected');
    this.sentMessages.push(message);

    // Auto-respond to requests
    if ('id' in message && 'method' in message) {
      const method = (message as { method: string }).method;
      if (this.autoResponses.has(method)) {
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: (message as { id: number | string }).id,
          result: this.autoResponses.get(method),
        };
        // Simulate async delivery
        setImmediate(() => this.simulateMessage(response));
      }
    }
  }

  async close(): Promise<void> {
    this._isConnected = false;
  }

  onMessage(handler: (msg: JsonRpcMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onError(handler: (err: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  onClose(handler: (code: number | null) => void): void {
    this.closeHandlers.push(handler);
  }

  // Test helpers
  simulateMessage(msg: JsonRpcMessage): void {
    for (const h of this.messageHandlers) h(msg);
  }

  simulateError(err: Error): void {
    for (const h of this.errorHandlers) h(err);
  }

  simulateClose(code: number | null): void {
    this._isConnected = false;
    for (const h of this.closeHandlers) h(code);
  }
}

function createMockInitResult(): InitializeResult {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: true } },
    serverInfo: { name: 'test-server', version: '1.0.0' },
  };
}

describe('MCPProtocol', () => {
  let transport: MockTransport;
  let protocol: MCPProtocol;

  beforeEach(() => {
    transport = new MockTransport();
    transport.autoResponses.set(MCP_METHODS.INITIALIZE, createMockInitResult());
    protocol = new MCPProtocol(transport);
  });

  describe('initialize', () => {
    it('should perform the initialize handshake', async () => {
      const result = await protocol.initialize({
        name: 'test-client',
        version: '0.1.0',
      });

      expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
      expect(result.serverInfo.name).toBe('test-server');
      expect(result.capabilities.tools).toBeDefined();
      expect(protocol.isInitialized).toBe(true);

      // Should have sent initialize request and initialized notification
      expect(transport.sentMessages).toHaveLength(2);
      expect((transport.sentMessages[0] as any).method).toBe(MCP_METHODS.INITIALIZE);
      expect((transport.sentMessages[1] as any).method).toBe(MCP_METHODS.INITIALIZED);
    });
  });

  describe('request', () => {
    it('should send a request and resolve with the result', async () => {
      transport.autoResponses.set('tools/list', { tools: [{ name: 'echo' }] });

      const result = await protocol.request<{ tools: { name: string }[] }>('tools/list');
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('echo');
    });

    it('should reject with MCPError on error response', async () => {
      // Set up a custom error response
      const origSend = transport.send.bind(transport);
      transport.send = async (msg: JsonRpcMessage) => {
        transport.sentMessages.push(msg);
        if ('id' in msg && 'method' in msg) {
          const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: (msg as any).id,
            error: { code: -32601, message: 'Method not found' },
          };
          setImmediate(() => transport.simulateMessage(response));
        }
      };

      await expect(protocol.request('nonexistent')).rejects.toThrow(MCPError);
    });

    it('should timeout if no response received', async () => {
      const fastProtocol = new MCPProtocol(transport, { timeout: 50 });
      // Don't set up auto-response for this method
      await expect(fastProtocol.request('slow/method')).rejects.toThrow(/timed out/);
    });
  });

  describe('notify', () => {
    it('should send a notification without waiting for response', async () => {
      await protocol.notify('notifications/test', { data: 'hello' });
      expect(transport.sentMessages).toHaveLength(1);

      const sent = transport.sentMessages[0] as any;
      expect(sent.method).toBe('notifications/test');
      expect(sent.id).toBeUndefined();
    });
  });

  describe('server notifications', () => {
    it('should dispatch server-initiated notifications', (done) => {
      protocol.onNotification('notifications/message', (params) => {
        expect(params.level).toBe('info');
        done();
      });

      transport.simulateMessage({
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'info', data: 'test' },
      });
    });
  });

  describe('shutdown', () => {
    it('should send shutdown and reject pending requests', async () => {
      transport.autoResponses.set(MCP_METHODS.SHUTDOWN, null);
      await protocol.initialize({ name: 'test', version: '0.1.0' });

      await protocol.shutdown();
      expect(protocol.isInitialized).toBe(false);
    });
  });

  describe('transport close', () => {
    it('should reject all pending requests on close', async () => {
      // Start a request but don't auto-respond
      const promise = protocol.request('slow/method');

      // Close the transport
      transport.simulateClose(1);

      await expect(promise).rejects.toThrow(/closed/);
    });
  });
});
