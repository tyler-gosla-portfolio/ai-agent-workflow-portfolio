import { ToolRouter } from '../../src/mcp/router';
import { ServerManager } from '../../src/mcp/server-manager';
import { ManifestManager } from '../../src/mcp/manifest';
import { PermissionGuard, AuditLog } from '../../src/mcp/security';

// We test the router's logic with mocked dependencies since
// full integration requires running MCP servers.

describe('ToolRouter', () => {
  let serverManager: ServerManager;
  let manifest: ManifestManager;
  let guard: PermissionGuard;
  let audit: AuditLog;
  let router: ToolRouter;

  beforeEach(() => {
    serverManager = new ServerManager();
    manifest = new ManifestManager('/tmp/test-manifest.json');
    guard = new PermissionGuard();
    audit = new AuditLog();
    router = new ToolRouter(serverManager, manifest, guard, audit);
  });

  describe('invoke', () => {
    it('should throw when tool not found', async () => {
      await expect(router.invoke('nonexistent')).rejects.toThrow(/not found/);
    });

    it('should throw when permission denied', async () => {
      manifest.addServer({ name: 'srv', command: 'echo', transport: 'stdio' });
      manifest.updateTools('srv', [{ name: 'blocked', inputSchema: { type: 'object' } }]);

      guard.loadRules([{ tool: 'blocked', allow: false }]);

      await expect(router.invoke('blocked')).rejects.toThrow(/Permission denied/);

      // Should have logged the denial
      const entries = audit.forServer('srv');
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('deny');
    });

    it('should throw when server not running', async () => {
      manifest.addServer({ name: 'srv', command: 'echo', transport: 'stdio' });
      manifest.updateTools('srv', [{ name: 'tool1', inputSchema: { type: 'object' } }]);

      // No permission rules = allow all
      await expect(router.invoke('tool1')).rejects.toThrow(/not running/);
    });
  });

  describe('listAllTools', () => {
    it('should return empty array when no servers running', async () => {
      const tools = await router.listAllTools();
      expect(tools).toEqual([]);
    });
  });
});
