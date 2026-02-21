/**
 * Server Manifest and Capabilities
 *
 * Manages the manifest of known MCP servers, their capabilities,
 * and cached tool/resource/prompt definitions.
 * Supports loading from config files and runtime discovery.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ServerConfig,
  ServerManifestEntry,
  GolemManifest,
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ServerCapabilities,
} from './types';

const MANIFEST_VERSION = '1.0';
const DEFAULT_MANIFEST_PATH = '.golem/mcp-manifest.json';

export class ManifestManager {
  private manifest: GolemManifest;
  private readonly manifestPath: string;

  constructor(manifestPath?: string) {
    this.manifestPath = manifestPath ?? path.resolve(process.cwd(), DEFAULT_MANIFEST_PATH);
    this.manifest = { version: MANIFEST_VERSION, servers: {} };
  }

  /**
   * Load manifest from disk. Creates a new one if it doesn't exist.
   */
  load(): GolemManifest {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const raw = fs.readFileSync(this.manifestPath, 'utf-8');
        this.manifest = JSON.parse(raw) as GolemManifest;
      }
    } catch {
      this.manifest = { version: MANIFEST_VERSION, servers: {} };
    }
    return this.manifest;
  }

  /**
   * Persist manifest to disk.
   */
  save(): void {
    const dir = path.dirname(this.manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf-8');
  }

  /**
   * Register a server config in the manifest.
   */
  addServer(config: ServerConfig): void {
    this.manifest.servers[config.name] = {
      config,
    };
  }

  /**
   * Remove a server from the manifest.
   */
  removeServer(name: string): boolean {
    if (name in this.manifest.servers) {
      delete this.manifest.servers[name];
      return true;
    }
    return false;
  }

  /**
   * Update discovered capabilities for a server.
   */
  updateCapabilities(name: string, capabilities: ServerCapabilities): void {
    const entry = this.manifest.servers[name];
    if (!entry) throw new Error(`Server "${name}" not in manifest`);
    entry.capabilities = capabilities;
    entry.lastDiscovered = new Date();
  }

  /**
   * Update the discovered tools for a server.
   */
  updateTools(name: string, tools: ToolDefinition[]): void {
    const entry = this.manifest.servers[name];
    if (!entry) throw new Error(`Server "${name}" not in manifest`);
    entry.tools = tools;
    entry.lastDiscovered = new Date();
  }

  /**
   * Update the discovered resources for a server.
   */
  updateResources(name: string, resources: ResourceDefinition[]): void {
    const entry = this.manifest.servers[name];
    if (!entry) throw new Error(`Server "${name}" not in manifest`);
    entry.resources = resources;
    entry.lastDiscovered = new Date();
  }

  /**
   * Update the discovered prompts for a server.
   */
  updatePrompts(name: string, prompts: PromptDefinition[]): void {
    const entry = this.manifest.servers[name];
    if (!entry) throw new Error(`Server "${name}" not in manifest`);
    entry.prompts = prompts;
    entry.lastDiscovered = new Date();
  }

  /**
   * Get a server's manifest entry.
   */
  getServer(name: string): ServerManifestEntry | undefined {
    return this.manifest.servers[name];
  }

  /**
   * List all server configs.
   */
  listServers(): ServerConfig[] {
    return Object.values(this.manifest.servers).map((entry) => entry.config);
  }

  /**
   * Get all known tools across all servers, namespaced as "server.toolname".
   */
  allTools(): Array<{ server: string; tool: ToolDefinition }> {
    const result: Array<{ server: string; tool: ToolDefinition }> = [];
    for (const [name, entry] of Object.entries(this.manifest.servers)) {
      if (entry.tools) {
        for (const tool of entry.tools) {
          result.push({ server: name, tool });
        }
      }
    }
    return result;
  }

  /**
   * Find a tool by its qualified name "server.toolname".
   */
  findTool(qualifiedName: string): { server: string; tool: ToolDefinition } | undefined {
    const dotIndex = qualifiedName.indexOf('.');
    if (dotIndex === -1) {
      // Search all servers for the tool
      for (const [name, entry] of Object.entries(this.manifest.servers)) {
        const tool = entry.tools?.find((t) => t.name === qualifiedName);
        if (tool) return { server: name, tool };
      }
      return undefined;
    }

    const serverName = qualifiedName.slice(0, dotIndex);
    const toolName = qualifiedName.slice(dotIndex + 1);
    const entry = this.manifest.servers[serverName];
    if (!entry?.tools) return undefined;

    const tool = entry.tools.find((t) => t.name === toolName);
    return tool ? { server: serverName, tool } : undefined;
  }

  /**
   * Get the raw manifest.
   */
  getManifest(): GolemManifest {
    return this.manifest;
  }
}

/**
 * Load server configs from a JSON config file.
 * Expected format: { "servers": [ { name, command, args, ... } ] }
 */
export function loadServerConfigs(configPath: string): ServerConfig[] {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as { servers: ServerConfig[] };

  if (!Array.isArray(parsed.servers)) {
    throw new Error(`Invalid config: expected "servers" array in ${configPath}`);
  }

  return parsed.servers.map((s): ServerConfig => ({
    ...s,
    transport: s.transport ?? 'stdio',
    autoStart: s.autoStart ?? true,
  }));
}
