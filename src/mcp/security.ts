/**
 * Security and Auth
 *
 * Permission guards for tool invocation, server allowlisting,
 * environment-based secret injection, and audit logging.
 */

import {
  ToolPermission,
  PermissionScope,
  ServerConfig,
  ToolDefinition,
} from './types';

// ---------------------------------------------------------------------------
// Permission Guard
// ---------------------------------------------------------------------------

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

export class PermissionGuard {
  private rules: ToolPermission[] = [];
  private serverAllowlist: Set<string> | null = null;

  /**
   * Load permission rules for a server.
   */
  loadRules(permissions: ToolPermission[]): void {
    this.rules = [...permissions];
  }

  /**
   * Set an allowlist of servers that are permitted to connect.
   * If null, all servers are allowed.
   */
  setServerAllowlist(servers: string[] | null): void {
    this.serverAllowlist = servers ? new Set(servers) : null;
  }

  /**
   * Check if a server is allowed to be started.
   */
  isServerAllowed(name: string): PermissionCheckResult {
    if (this.serverAllowlist === null) {
      return { allowed: true };
    }
    if (this.serverAllowlist.has(name)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Server "${name}" is not in the allowlist` };
  }

  /**
   * Check if a tool invocation is permitted.
   */
  checkToolPermission(toolName: string, requiredScopes?: PermissionScope[]): PermissionCheckResult {
    // If no rules defined, allow everything
    if (this.rules.length === 0) {
      return { allowed: true };
    }

    // Find the most specific matching rule
    const match = this.findMatchingRule(toolName);

    if (!match) {
      // Default deny when rules exist but none match
      return { allowed: false, reason: `No permission rule matches tool "${toolName}"` };
    }

    if (!match.allow) {
      return { allowed: false, reason: `Tool "${toolName}" is explicitly denied` };
    }

    // Check scopes if required
    if (requiredScopes && requiredScopes.length > 0 && match.scopes) {
      const missingScopes = requiredScopes.filter((s) => !match.scopes!.includes(s));
      if (missingScopes.length > 0) {
        return {
          allowed: false,
          reason: `Tool "${toolName}" missing scopes: ${missingScopes.join(', ')}`,
        };
      }
    }

    return { allowed: true };
  }

  private findMatchingRule(toolName: string): ToolPermission | null {
    // Exact match first
    const exact = this.rules.find((r) => r.tool === toolName);
    if (exact) return exact;

    // Glob match (simple glob with * wildcard)
    const globMatch = this.rules
      .filter((r) => r.tool.includes('*'))
      .find((r) => matchGlob(r.tool, toolName));
    if (globMatch) return globMatch;

    // Catch-all "*"
    const catchAll = this.rules.find((r) => r.tool === '*');
    return catchAll ?? null;
  }
}

/**
 * Simple glob matching for tool permission patterns.
 * Supports * as wildcard for any sequence of characters.
 */
function matchGlob(pattern: string, value: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return regex.test(value);
}

// ---------------------------------------------------------------------------
// Environment Secret Provider
// ---------------------------------------------------------------------------

export class SecretProvider {
  private secrets = new Map<string, string>();

  /**
   * Load secrets from environment variables matching a prefix.
   * e.g., prefix="GOLEM_MCP_" captures GOLEM_MCP_API_KEY -> API_KEY
   */
  loadFromEnv(prefix = 'GOLEM_MCP_'): void {
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix) && value !== undefined) {
        const name = key.slice(prefix.length);
        this.secrets.set(name, value);
      }
    }
  }

  /**
   * Get a secret by name.
   */
  get(name: string): string | undefined {
    return this.secrets.get(name);
  }

  /**
   * Set a secret manually.
   */
  set(name: string, value: string): void {
    this.secrets.set(name, value);
  }

  /**
   * Build an environment map for a server process,
   * injecting relevant secrets.
   */
  buildEnv(serverConfig: ServerConfig): Record<string, string> {
    const env: Record<string, string> = { ...serverConfig.env };

    // Inject secrets that match the pattern SERVERNAME_*
    const prefix = serverConfig.name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_';
    for (const [key, value] of this.secrets) {
      if (key.startsWith(prefix)) {
        env[key] = value;
      }
    }

    return env;
  }
}

// ---------------------------------------------------------------------------
// Audit Logger
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: string;
  server: string;
  tool: string;
  action: 'invoke' | 'deny' | 'error';
  arguments?: Record<string, unknown>;
  result?: 'success' | 'failure';
  reason?: string;
  durationMs?: number;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  record(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * Log a tool invocation.
   */
  logInvocation(
    server: string,
    tool: string,
    args?: Record<string, unknown>,
    result?: 'success' | 'failure',
    durationMs?: number,
  ): void {
    this.record({
      timestamp: new Date().toISOString(),
      server,
      tool,
      action: 'invoke',
      arguments: this.redactSensitive(args),
      result,
      durationMs,
    });
  }

  /**
   * Log a denied invocation.
   */
  logDenial(server: string, tool: string, reason: string): void {
    this.record({
      timestamp: new Date().toISOString(),
      server,
      tool,
      action: 'deny',
      reason,
    });
  }

  /**
   * Get recent audit entries.
   */
  recent(count = 50): AuditEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * Get all entries for a specific server.
   */
  forServer(server: string): AuditEntry[] {
    return this.entries.filter((e) => e.server === server);
  }

  /**
   * Get the total count of entries.
   */
  get count(): number {
    return this.entries.length;
  }

  /**
   * Redact sensitive fields from arguments before logging.
   */
  private redactSensitive(args?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!args) return undefined;

    const SENSITIVE_KEYS = ['password', 'secret', 'token', 'api_key', 'apiKey', 'authorization'];
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }
}
