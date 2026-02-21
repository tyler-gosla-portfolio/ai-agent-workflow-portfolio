import {
  formatServerState,
  formatServerList,
  formatToolList,
  formatToolResult,
  formatAuditLog,
  formatError,
  formatJSON,
} from '../../src/cli/formatter';
import { ServerState, ToolDefinition, ToolCallResult } from '../../src/mcp/types';
import { AuditEntry } from '../../src/mcp/security';

describe('Formatter', () => {
  describe('formatServerState', () => {
    it('should format a running server', () => {
      const state: ServerState = {
        name: 'test-server',
        status: 'running',
        toolCount: 5,
        serverInfo: { name: 'myserver', version: '1.0.0' },
        startedAt: new Date('2026-01-01T00:00:00Z'),
      };

      const output = formatServerState(state);
      expect(output).toContain('[OK]');
      expect(output).toContain('test-server');
      expect(output).toContain('running');
      expect(output).toContain('tools=5');
      expect(output).toContain('myserver@1.0.0');
    });

    it('should format a stopped server', () => {
      const state: ServerState = { name: 'stopped-srv', status: 'stopped' };
      const output = formatServerState(state);
      expect(output).toContain('[--]');
      expect(output).toContain('stopped');
    });

    it('should format an error server', () => {
      const state: ServerState = {
        name: 'err-srv',
        status: 'error',
        error: 'Connection refused',
      };
      const output = formatServerState(state);
      expect(output).toContain('[!!]');
      expect(output).toContain('Connection refused');
    });
  });

  describe('formatServerList', () => {
    it('should show empty message', () => {
      expect(formatServerList([])).toContain('No servers');
    });

    it('should list multiple servers', () => {
      const states: ServerState[] = [
        { name: 'a', status: 'running', toolCount: 3 },
        { name: 'b', status: 'stopped' },
      ];
      const output = formatServerList(states);
      expect(output).toContain('MCP Servers');
      expect(output).toContain('a');
      expect(output).toContain('b');
    });
  });

  describe('formatToolList', () => {
    it('should show empty message', () => {
      expect(formatToolList([])).toContain('No tools');
    });

    it('should group tools by server', () => {
      const tools: Array<{ server: string; tool: ToolDefinition }> = [
        {
          server: 'srv1',
          tool: {
            name: 'echo',
            description: 'Echo a message',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string' } },
              required: ['message'],
            },
          },
        },
        {
          server: 'srv2',
          tool: {
            name: 'add',
            inputSchema: { type: 'object' },
          },
        },
      ];

      const output = formatToolList(tools);
      expect(output).toContain('[srv1]');
      expect(output).toContain('echo');
      expect(output).toContain('Echo a message');
      expect(output).toContain('message: string (required)');
      expect(output).toContain('[srv2]');
      expect(output).toContain('add');
    });
  });

  describe('formatToolResult', () => {
    it('should format text content', () => {
      const result: ToolCallResult = {
        content: [{ type: 'text', text: 'Hello world' }],
      };
      expect(formatToolResult(result)).toContain('Hello world');
    });

    it('should format error result', () => {
      const result: ToolCallResult = {
        content: [{ type: 'text', text: 'Something failed' }],
        isError: true,
      };
      const output = formatToolResult(result);
      expect(output).toContain('Error');
      expect(output).toContain('Something failed');
    });

    it('should show duration', () => {
      const result: ToolCallResult = {
        content: [{ type: 'text', text: 'ok' }],
      };
      expect(formatToolResult(result, 150)).toContain('150ms');
    });

    it('should handle image content', () => {
      const result: ToolCallResult = {
        content: [{ type: 'image', mimeType: 'image/png' }],
      };
      expect(formatToolResult(result)).toContain('[image: image/png]');
    });
  });

  describe('formatAuditLog', () => {
    it('should show empty message', () => {
      expect(formatAuditLog([])).toContain('No audit');
    });

    it('should format entries', () => {
      const entries: AuditEntry[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          server: 'srv1',
          tool: 'echo',
          action: 'invoke',
          result: 'success',
          durationMs: 50,
        },
        {
          timestamp: '2026-01-01T00:00:01Z',
          server: 'srv1',
          tool: 'blocked',
          action: 'deny',
          reason: 'Not allowed',
        },
      ];

      const output = formatAuditLog(entries);
      expect(output).toContain('Audit Log');
      expect(output).toContain('INVOKE');
      expect(output).toContain('DENY');
      expect(output).toContain('50ms');
      expect(output).toContain('Not allowed');
    });
  });

  describe('formatError', () => {
    it('should format Error instances', () => {
      expect(formatError(new Error('test'))).toBe('Error: test');
    });

    it('should format non-Error values', () => {
      expect(formatError('string error')).toBe('Error: string error');
    });
  });

  describe('formatJSON', () => {
    it('should pretty-print JSON', () => {
      const output = formatJSON({ key: 'value' });
      expect(output).toContain('"key"');
      expect(output).toContain('"value"');
    });
  });
});
