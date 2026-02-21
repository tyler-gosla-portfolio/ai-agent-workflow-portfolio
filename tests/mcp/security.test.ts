import { PermissionGuard, SecretProvider, AuditLog } from '../../src/mcp/security';
import { ToolPermission } from '../../src/mcp/types';

describe('PermissionGuard', () => {
  let guard: PermissionGuard;

  beforeEach(() => {
    guard = new PermissionGuard();
  });

  describe('with no rules', () => {
    it('should allow everything', () => {
      const result = guard.checkToolPermission('any_tool');
      expect(result.allowed).toBe(true);
    });
  });

  describe('server allowlist', () => {
    it('should allow all servers when no allowlist set', () => {
      expect(guard.isServerAllowed('anything').allowed).toBe(true);
    });

    it('should restrict to allowlisted servers', () => {
      guard.setServerAllowlist(['trusted', 'also-trusted']);

      expect(guard.isServerAllowed('trusted').allowed).toBe(true);
      expect(guard.isServerAllowed('also-trusted').allowed).toBe(true);
      expect(guard.isServerAllowed('untrusted').allowed).toBe(false);
      expect(guard.isServerAllowed('untrusted').reason).toContain('allowlist');
    });

    it('should allow all when allowlist is cleared', () => {
      guard.setServerAllowlist(['only-one']);
      guard.setServerAllowlist(null);
      expect(guard.isServerAllowed('anything').allowed).toBe(true);
    });
  });

  describe('tool permission rules', () => {
    it('should match exact tool names', () => {
      guard.loadRules([
        { tool: 'read_file', allow: true, scopes: ['read'] },
        { tool: 'delete_file', allow: false },
      ]);

      expect(guard.checkToolPermission('read_file').allowed).toBe(true);
      expect(guard.checkToolPermission('delete_file').allowed).toBe(false);
    });

    it('should match glob patterns', () => {
      guard.loadRules([
        { tool: 'file_*', allow: true, scopes: ['read', 'write'] },
        { tool: 'exec_*', allow: false },
      ]);

      expect(guard.checkToolPermission('file_read').allowed).toBe(true);
      expect(guard.checkToolPermission('file_write').allowed).toBe(true);
      expect(guard.checkToolPermission('exec_command').allowed).toBe(false);
    });

    it('should use catch-all rule as fallback', () => {
      guard.loadRules([
        { tool: 'allowed_tool', allow: true },
        { tool: '*', allow: false },
      ]);

      expect(guard.checkToolPermission('allowed_tool').allowed).toBe(true);
      expect(guard.checkToolPermission('other_tool').allowed).toBe(false);
    });

    it('should deny when rules exist but none match', () => {
      guard.loadRules([{ tool: 'specific_tool', allow: true }]);

      const result = guard.checkToolPermission('unknown_tool');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No permission rule');
    });

    it('should check required scopes', () => {
      guard.loadRules([
        { tool: 'limited_tool', allow: true, scopes: ['read'] },
      ]);

      expect(guard.checkToolPermission('limited_tool', ['read']).allowed).toBe(true);
      expect(guard.checkToolPermission('limited_tool', ['write']).allowed).toBe(false);
      expect(guard.checkToolPermission('limited_tool', ['read', 'write']).reason).toContain('missing scopes');
    });
  });
});

describe('SecretProvider', () => {
  let secrets: SecretProvider;

  beforeEach(() => {
    secrets = new SecretProvider();
  });

  describe('loadFromEnv', () => {
    it('should load secrets with matching prefix', () => {
      const origEnv = process.env;
      process.env = {
        ...origEnv,
        GOLEM_MCP_API_KEY: 'secret123',
        GOLEM_MCP_SERVER_TOKEN: 'token456',
        UNRELATED_VAR: 'ignored',
      };

      secrets.loadFromEnv();

      expect(secrets.get('API_KEY')).toBe('secret123');
      expect(secrets.get('SERVER_TOKEN')).toBe('token456');
      expect(secrets.get('UNRELATED_VAR')).toBeUndefined();

      process.env = origEnv;
    });
  });

  describe('set/get', () => {
    it('should store and retrieve secrets', () => {
      secrets.set('MY_KEY', 'my_value');
      expect(secrets.get('MY_KEY')).toBe('my_value');
    });
  });

  describe('buildEnv', () => {
    it('should inject server-specific secrets', () => {
      secrets.set('MYSERVER_API_KEY', 'key123');
      secrets.set('OTHER_KEY', 'ignored');

      const env = secrets.buildEnv({
        name: 'myserver',
        command: 'echo',
        transport: 'stdio',
        env: { BASE_VAR: 'base' },
      });

      expect(env.BASE_VAR).toBe('base');
      expect(env.MYSERVER_API_KEY).toBe('key123');
      expect(env.OTHER_KEY).toBeUndefined();
    });
  });
});

describe('AuditLog', () => {
  let audit: AuditLog;

  beforeEach(() => {
    audit = new AuditLog(100);
  });

  describe('logInvocation', () => {
    it('should record tool invocations', () => {
      audit.logInvocation('server1', 'echo', { message: 'hi' }, 'success', 50);
      expect(audit.count).toBe(1);

      const entries = audit.recent();
      expect(entries[0].action).toBe('invoke');
      expect(entries[0].server).toBe('server1');
      expect(entries[0].tool).toBe('echo');
      expect(entries[0].durationMs).toBe(50);
    });

    it('should redact sensitive fields', () => {
      audit.logInvocation('s', 't', { api_key: 'secret', data: 'visible' }, 'success');
      const entry = audit.recent()[0];
      expect(entry.arguments?.api_key).toBe('[REDACTED]');
      expect(entry.arguments?.data).toBe('visible');
    });

    it('should redact password fields', () => {
      audit.logInvocation('s', 't', { password: 'secret', token: 'hidden' }, 'success');
      const entry = audit.recent()[0];
      expect(entry.arguments?.password).toBe('[REDACTED]');
      expect(entry.arguments?.token).toBe('[REDACTED]');
    });
  });

  describe('logDenial', () => {
    it('should record denied invocations', () => {
      audit.logDenial('server1', 'dangerous_tool', 'Not allowed');
      const entries = audit.recent();
      expect(entries[0].action).toBe('deny');
      expect(entries[0].reason).toBe('Not allowed');
    });
  });

  describe('forServer', () => {
    it('should filter entries by server', () => {
      audit.logInvocation('s1', 't1', undefined, 'success');
      audit.logInvocation('s2', 't2', undefined, 'success');
      audit.logInvocation('s1', 't3', undefined, 'failure');

      const s1Entries = audit.forServer('s1');
      expect(s1Entries).toHaveLength(2);
      expect(s1Entries.every((e) => e.server === 's1')).toBe(true);
    });
  });

  describe('max entries', () => {
    it('should evict old entries when limit is reached', () => {
      const smallAudit = new AuditLog(5);

      for (let i = 0; i < 10; i++) {
        smallAudit.logInvocation('s', `tool_${i}`, undefined, 'success');
      }

      expect(smallAudit.count).toBe(5);
      const entries = smallAudit.recent();
      expect(entries[0].tool).toBe('tool_5');
    });
  });
});
