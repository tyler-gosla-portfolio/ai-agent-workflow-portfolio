import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ManifestManager, loadServerConfigs } from '../../src/mcp/manifest';
import { ServerConfig, ToolDefinition } from '../../src/mcp/types';

describe('ManifestManager', () => {
  let tmpDir: string;
  let manifestPath: string;
  let manager: ManifestManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-test-'));
    manifestPath = path.join(tmpDir, '.golem', 'mcp-manifest.json');
    manager = new ManifestManager(manifestPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('should create a new manifest if none exists', () => {
      const manifest = manager.load();
      expect(manifest.version).toBe('1.0');
      expect(manifest.servers).toEqual({});
    });

    it('should load an existing manifest', () => {
      const dir = path.dirname(manifestPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          version: '1.0',
          servers: {
            test: {
              config: { name: 'test', command: 'echo', transport: 'stdio' },
              tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
            },
          },
        }),
      );

      const manifest = manager.load();
      expect(Object.keys(manifest.servers)).toHaveLength(1);
      expect(manifest.servers.test.tools).toHaveLength(1);
    });

    it('should handle corrupted manifest files', () => {
      const dir = path.dirname(manifestPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(manifestPath, 'not json');

      const manifest = manager.load();
      expect(manifest.version).toBe('1.0');
      expect(manifest.servers).toEqual({});
    });
  });

  describe('save', () => {
    it('should persist manifest to disk', () => {
      manager.addServer({
        name: 'test',
        command: 'echo',
        transport: 'stdio',
      });

      manager.save();

      expect(fs.existsSync(manifestPath)).toBe(true);
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.servers.test).toBeDefined();
    });

    it('should create directories if they do not exist', () => {
      manager.save();
      expect(fs.existsSync(path.dirname(manifestPath))).toBe(true);
    });
  });

  describe('addServer / removeServer', () => {
    it('should add and remove servers', () => {
      const config: ServerConfig = {
        name: 'myserver',
        command: 'node',
        args: ['server.js'],
        transport: 'stdio',
      };

      manager.addServer(config);
      expect(manager.getServer('myserver')).toBeDefined();

      expect(manager.removeServer('myserver')).toBe(true);
      expect(manager.getServer('myserver')).toBeUndefined();
    });

    it('should return false when removing non-existent server', () => {
      expect(manager.removeServer('ghost')).toBe(false);
    });
  });

  describe('updateCapabilities', () => {
    it('should update and store capabilities', () => {
      manager.addServer({ name: 'srv', command: 'echo', transport: 'stdio' });
      manager.updateCapabilities('srv', { tools: { listChanged: true } });

      const entry = manager.getServer('srv')!;
      expect(entry.capabilities?.tools?.listChanged).toBe(true);
      expect(entry.lastDiscovered).toBeDefined();
    });

    it('should throw for unknown server', () => {
      expect(() => manager.updateCapabilities('x', {})).toThrow();
    });
  });

  describe('updateTools', () => {
    it('should store discovered tools', () => {
      manager.addServer({ name: 'srv', command: 'echo', transport: 'stdio' });

      const tools: ToolDefinition[] = [
        { name: 'echo', description: 'Echo', inputSchema: { type: 'object' } },
        { name: 'add', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
      ];

      manager.updateTools('srv', tools);
      expect(manager.getServer('srv')!.tools).toHaveLength(2);
    });
  });

  describe('listServers', () => {
    it('should return all server configs', () => {
      manager.addServer({ name: 'a', command: 'a', transport: 'stdio' });
      manager.addServer({ name: 'b', command: 'b', transport: 'stdio' });

      const servers = manager.listServers();
      expect(servers).toHaveLength(2);
    });
  });

  describe('allTools', () => {
    it('should aggregate tools across servers', () => {
      manager.addServer({ name: 'srv1', command: 'a', transport: 'stdio' });
      manager.addServer({ name: 'srv2', command: 'b', transport: 'stdio' });

      manager.updateTools('srv1', [{ name: 'tool_a', inputSchema: { type: 'object' } }]);
      manager.updateTools('srv2', [{ name: 'tool_b', inputSchema: { type: 'object' } }]);

      const all = manager.allTools();
      expect(all).toHaveLength(2);
      expect(all.map((t) => t.server)).toEqual(['srv1', 'srv2']);
    });
  });

  describe('findTool', () => {
    beforeEach(() => {
      manager.addServer({ name: 'srv1', command: 'a', transport: 'stdio' });
      manager.addServer({ name: 'srv2', command: 'b', transport: 'stdio' });
      manager.updateTools('srv1', [{ name: 'echo', inputSchema: { type: 'object' } }]);
      manager.updateTools('srv2', [{ name: 'add', inputSchema: { type: 'object' } }]);
    });

    it('should find tool by qualified name', () => {
      const result = manager.findTool('srv1.echo');
      expect(result?.server).toBe('srv1');
      expect(result?.tool.name).toBe('echo');
    });

    it('should find tool by unqualified name across servers', () => {
      const result = manager.findTool('add');
      expect(result?.server).toBe('srv2');
    });

    it('should return undefined for missing tool', () => {
      expect(manager.findTool('nonexistent')).toBeUndefined();
    });

    it('should return undefined for wrong server in qualified name', () => {
      expect(manager.findTool('srv1.add')).toBeUndefined();
    });
  });
});

describe('loadServerConfigs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-cfg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should load server configs from a JSON file', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        servers: [
          { name: 'test', command: 'node', args: ['server.js'] },
        ],
      }),
    );

    const configs = loadServerConfigs(configPath);
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('test');
    expect(configs[0].transport).toBe('stdio');
    expect(configs[0].autoStart).toBe(true);
  });

  it('should throw on invalid config format', () => {
    const configPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(configPath, JSON.stringify({ notServers: [] }));

    expect(() => loadServerConfigs(configPath)).toThrow(/servers/);
  });
});
