import {
  CommandContext,
  createCommandContext,
  dispatchMcpCommand,
  cmdAdd,
  cmdRemove,
  cmdList,
  cmdAudit,
} from '../../src/cli/mcp-commands';
import { ServerManager } from '../../src/mcp/server-manager';
import { ManifestManager } from '../../src/mcp/manifest';
import { PermissionGuard, AuditLog, SecretProvider } from '../../src/mcp/security';
import { ToolRouter } from '../../src/mcp/router';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function createTestContext(): { ctx: CommandContext; output: string[] } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-cli-test-'));
  const manifestPath = path.join(tmpDir, '.golem', 'mcp-manifest.json');

  const serverManager = new ServerManager();
  const manifest = new ManifestManager(manifestPath);
  const guard = new PermissionGuard();
  const audit = new AuditLog();
  const secrets = new SecretProvider();
  const router = new ToolRouter(serverManager, manifest, guard, audit);

  const output: string[] = [];

  const ctx: CommandContext = {
    serverManager,
    manifest,
    guard,
    audit,
    secrets,
    router,
    output: (msg: string) => output.push(msg),
  };

  return { ctx, output };
}

describe('CLI MCP Commands', () => {
  let ctx: CommandContext;
  let output: string[];

  beforeEach(() => {
    const result = createTestContext();
    ctx = result.ctx;
    output = result.output;
  });

  describe('cmdAdd', () => {
    it('should add a server to the manifest', async () => {
      await cmdAdd(ctx, 'test-srv', 'node', ['server.js']);
      expect(output[0]).toContain('added');

      const entry = ctx.manifest.getServer('test-srv');
      expect(entry).toBeDefined();
      expect(entry!.config.command).toBe('node');
      expect(entry!.config.args).toEqual(['server.js']);
    });
  });

  describe('cmdRemove', () => {
    it('should remove a server from the manifest', async () => {
      await cmdAdd(ctx, 'to-remove', 'echo', []);
      output.length = 0;

      await cmdRemove(ctx, 'to-remove');
      expect(output[0]).toContain('removed');
      expect(ctx.manifest.getServer('to-remove')).toBeUndefined();
    });

    it('should show error for non-existent server', async () => {
      await cmdRemove(ctx, 'ghost');
      expect(output[0]).toContain('Error');
    });
  });

  describe('cmdList', () => {
    it('should list all servers including manifest-only', async () => {
      await cmdAdd(ctx, 'srv1', 'echo', []);
      await cmdAdd(ctx, 'srv2', 'node', []);
      output.length = 0;

      await cmdList(ctx);
      expect(output[0]).toContain('MCP Servers');
      expect(output[0]).toContain('srv1');
      expect(output[0]).toContain('srv2');
    });

    it('should show empty message when no servers', async () => {
      await cmdList(ctx);
      expect(output[0]).toContain('No servers');
    });
  });

  describe('cmdAudit', () => {
    it('should show empty audit log', async () => {
      await cmdAudit(ctx);
      expect(output[0]).toContain('No audit');
    });

    it('should show audit entries after activity', async () => {
      ctx.audit.logInvocation('srv1', 'echo', { msg: 'hi' }, 'success', 10);
      ctx.audit.logDenial('srv1', 'blocked', 'Not allowed');
      output.length = 0;

      await cmdAudit(ctx);
      expect(output[0]).toContain('Audit Log');
      expect(output[0]).toContain('INVOKE');
      expect(output[0]).toContain('DENY');
    });

    it('should filter by server name', async () => {
      ctx.audit.logInvocation('srv1', 'tool1', undefined, 'success');
      ctx.audit.logInvocation('srv2', 'tool2', undefined, 'success');
      output.length = 0;

      await cmdAudit(ctx, 'srv1');
      expect(output[0]).toContain('srv1');
      expect(output[0]).not.toContain('srv2');
    });
  });

  describe('dispatchMcpCommand', () => {
    it('should show help for unknown subcommand', async () => {
      await dispatchMcpCommand(ctx, ['unknown']);
      expect(output[0]).toContain('golem mcp');
    });

    it('should show help for empty args', async () => {
      await dispatchMcpCommand(ctx, []);
      expect(output[0]).toContain('golem mcp');
    });

    it('should show usage for start without name', async () => {
      await dispatchMcpCommand(ctx, ['start']);
      expect(output[0]).toContain('Usage');
    });

    it('should show usage for stop without name', async () => {
      await dispatchMcpCommand(ctx, ['stop']);
      expect(output[0]).toContain('Usage');
    });

    it('should show usage for call without tool name', async () => {
      await dispatchMcpCommand(ctx, ['call']);
      expect(output[0]).toContain('Usage');
    });

    it('should show usage for add without required args', async () => {
      await dispatchMcpCommand(ctx, ['add']);
      expect(output[0]).toContain('Usage');
    });

    it('should dispatch list/ls aliases', async () => {
      await dispatchMcpCommand(ctx, ['ls']);
      expect(output[0]).toContain('No servers');
    });

    it('should dispatch remove/rm aliases', async () => {
      await dispatchMcpCommand(ctx, ['rm', 'ghost']);
      expect(output[0]).toContain('Error');
    });

    it('should dispatch add with full args', async () => {
      await dispatchMcpCommand(ctx, ['add', 'myserver', 'npx', '-y', '@mcp/server']);
      expect(output[0]).toContain('added');

      const entry = ctx.manifest.getServer('myserver');
      expect(entry?.config.args).toEqual(['-y', '@mcp/server']);
    });
  });
});
