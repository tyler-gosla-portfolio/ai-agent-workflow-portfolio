import { MCPClient } from '../../src/mcp/client';
import { Transport } from '../../src/mcp/transport';
import {
  JsonRpcMessage,
  MCP_METHODS,
  MCP_PROTOCOL_VERSION,
  InitializeResult,
  ToolsListResult,
  ToolCallResult,
  ResourcesListResult,
  ResourceReadResult,
} from '../../src/mcp/types';

class MockTransport implements Transport {
  private messageHandlers: Array<(msg: JsonRpcMessage) => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];
  private closeHandlers: Array<(code: number | null) => void> = [];
  public sentMessages: JsonRpcMessage[] = [];
  private _isConnected = true;
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

    if ('id' in message && 'method' in message) {
      const method = (message as any).method;
      if (this.autoResponses.has(method)) {
        setImmediate(() => {
          for (const h of this.messageHandlers) {
            h({
              jsonrpc: '2.0',
              id: (message as any).id,
              result: this.autoResponses.get(method),
            } as any);
          }
        });
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
}

function setupTransport(): MockTransport {
  const transport = new MockTransport();

  const initResult: InitializeResult = {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: false },
    },
    serverInfo: { name: 'mock-server', version: '1.0.0' },
  };

  transport.autoResponses.set(MCP_METHODS.INITIALIZE, initResult);
  transport.autoResponses.set(MCP_METHODS.SHUTDOWN, null);

  return transport;
}

describe('MCPClient', () => {
  let transport: MockTransport;
  let client: MCPClient;

  beforeEach(async () => {
    transport = setupTransport();
    client = new MCPClient({ timeout: 5000 });
    await client.connectWithTransport(transport);
  });

  afterEach(async () => {
    if (client.isConnected) {
      await client.disconnect();
    }
  });

  describe('connect', () => {
    it('should connect and store server info', () => {
      expect(client.isConnected).toBe(true);
      expect(client.server?.name).toBe('mock-server');
      expect(client.capabilities?.tools).toBeDefined();
    });

    it('should reject double connect', async () => {
      await expect(client.connectWithTransport(transport)).rejects.toThrow(/already connected/);
    });
  });

  describe('disconnect', () => {
    it('should disconnect and clear state', async () => {
      await client.disconnect();
      expect(client.isConnected).toBe(false);
      expect(client.server).toBeNull();
      expect(client.capabilities).toBeNull();
    });
  });

  describe('listTools', () => {
    it('should return tool definitions', async () => {
      const toolsResult: ToolsListResult = {
        tools: [
          {
            name: 'echo',
            description: 'Echo a message',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string' } },
              required: ['message'],
            },
          },
        ],
      };
      transport.autoResponses.set(MCP_METHODS.TOOLS_LIST, toolsResult);

      const result = await client.listTools();
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('echo');
    });
  });

  describe('callTool', () => {
    it('should invoke a tool and return the result', async () => {
      const callResult: ToolCallResult = {
        content: [{ type: 'text', text: 'hello world' }],
      };
      transport.autoResponses.set(MCP_METHODS.TOOLS_CALL, callResult);

      const result = await client.callTool('echo', { message: 'hello world' });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe('hello world');
    });

    it('should handle error results', async () => {
      const callResult: ToolCallResult = {
        content: [{ type: 'text', text: 'Something went wrong' }],
        isError: true,
      };
      transport.autoResponses.set(MCP_METHODS.TOOLS_CALL, callResult);

      const result = await client.callTool('broken_tool', {});
      expect(result.isError).toBe(true);
    });
  });

  describe('getTool', () => {
    it('should fetch and cache tools, then find by name', async () => {
      const toolsResult: ToolsListResult = {
        tools: [
          { name: 'a', inputSchema: { type: 'object' } },
          { name: 'b', description: 'Tool B', inputSchema: { type: 'object' } },
        ],
      };
      transport.autoResponses.set(MCP_METHODS.TOOLS_LIST, toolsResult);

      const tool = await client.getTool('b');
      expect(tool?.name).toBe('b');
      expect(tool?.description).toBe('Tool B');

      const missing = await client.getTool('nonexistent');
      expect(missing).toBeUndefined();
    });
  });

  describe('listResources', () => {
    it('should return resource definitions', async () => {
      const result: ResourcesListResult = {
        resources: [
          { uri: 'file:///test.txt', name: 'test.txt', mimeType: 'text/plain' },
        ],
      };
      transport.autoResponses.set(MCP_METHODS.RESOURCES_LIST, result);

      const res = await client.listResources();
      expect(res.resources).toHaveLength(1);
      expect(res.resources[0].uri).toBe('file:///test.txt');
    });
  });

  describe('readResource', () => {
    it('should read a resource by URI', async () => {
      const result: ResourceReadResult = {
        contents: [{ uri: 'file:///test.txt', text: 'hello', mimeType: 'text/plain' }],
      };
      transport.autoResponses.set(MCP_METHODS.RESOURCES_READ, result);

      const res = await client.readResource('file:///test.txt');
      expect(res.contents[0].text).toBe('hello');
    });
  });

  describe('not connected', () => {
    it('should throw when calling methods before connect', async () => {
      const freshClient = new MCPClient();
      await expect(freshClient.listTools()).rejects.toThrow(/not connected/i);
      await expect(freshClient.callTool('x', {})).rejects.toThrow(/not connected/i);
    });
  });
});
