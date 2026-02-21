import { ServerManager } from '../../src/mcp/server-manager';
import { ServerConfig, ServerState } from '../../src/mcp/types';

// We can't easily test real server spawning in unit tests,
// so we test the state management and error handling logic.

jest.setTimeout(15_000);

describe('ServerManager', () => {
  let manager: ServerManager;

  beforeEach(() => {
    manager = new ServerManager({ timeout: 2000 });
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe('list', () => {
    it('should return empty list initially', () => {
      expect(manager.list()).toEqual([]);
    });
  });

  describe('get', () => {
    it('should return undefined for unknown server', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getClient', () => {
    it('should return undefined for unknown server', () => {
      expect(manager.getClient('nonexistent')).toBeUndefined();
    });
  });

  describe('start', () => {
    it('should fail when initialize handshake times out', async () => {
      // Process starts but doesn't speak MCP protocol, so initialize times out
      const config: ServerConfig = {
        name: 'bad-server',
        command: 'node',
        args: ['-e', 'process.stdin.resume(); setTimeout(() => {}, 10000)'],
        transport: 'stdio',
      };

      await expect(manager.start(config)).rejects.toThrow();

      // Failed server should be cleaned up from the list
      expect(manager.list()).toHaveLength(0);
    });
  });

  describe('stop', () => {
    it('should throw for unknown server', async () => {
      await expect(manager.stop('nonexistent')).rejects.toThrow(/not found/);
    });
  });

  describe('restart', () => {
    it('should throw for unknown server', async () => {
      await expect(manager.restart('nonexistent')).rejects.toThrow(/not found/);
    });
  });

  describe('startAll', () => {
    it('should register autoStart=false servers without starting', async () => {
      const configs: ServerConfig[] = [
        {
          name: 'manual-server',
          command: 'echo',
          transport: 'stdio',
          autoStart: false,
        },
      ];

      const results = await manager.startAll(configs);
      expect(results.get('manual-server')?.status).toBe('stopped');

      // Should appear in list
      const list = manager.list();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('manual-server');
      expect(list[0].status).toBe('stopped');
    });

    it('should report errors for servers that fail to start', async () => {
      const configs: ServerConfig[] = [
        {
          name: 'fail-server',
          command: 'node',
          args: ['-e', 'process.stdin.resume(); setTimeout(() => {}, 10000)'],
          transport: 'stdio',
          autoStart: true,
        },
      ];

      const results = await manager.startAll(configs);
      expect(results.get('fail-server')?.status).toBe('error');
    });
  });

  describe('stopAll', () => {
    it('should handle empty server list', async () => {
      // Should not throw
      await manager.stopAll();
    });
  });

  describe('onStateChange', () => {
    it('should emit state changes', async () => {
      const changes: Array<{ name: string; state: ServerState }> = [];
      manager.onStateChange((name, state) => {
        changes.push({ name, state });
      });

      const config: ServerConfig = {
        name: 'event-server',
        command: 'node',
        args: ['-e', 'process.stdin.resume(); setTimeout(() => {}, 10000)'],
        transport: 'stdio',
      };

      try {
        await manager.start(config);
      } catch {
        // Expected to fail
      }

      // Should have emitted at least "starting" and "error" states
      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes[0].name).toBe('event-server');
    });
  });
});
