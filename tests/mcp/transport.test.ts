import { StdioTransport } from '../../src/mcp/transport';

describe('StdioTransport', () => {
  describe('constructor', () => {
    it('should create transport with command and default options', () => {
      const transport = new StdioTransport({ command: 'echo' });
      expect(transport.isConnected).toBe(false);
    });

    it('should accept custom options', () => {
      const transport = new StdioTransport({
        command: 'node',
        args: ['-e', 'process.stdin.resume()'],
        env: { FOO: 'bar' },
        timeout: 5000,
      });
      expect(transport.isConnected).toBe(false);
    });
  });

  describe('start', () => {
    it('should detect when a process exits immediately', async () => {
      // Use a process that starts but exits right away (exit code 1)
      const transport = new StdioTransport({
        command: 'node',
        args: ['-e', 'process.exit(1)'],
      });

      // The process starts (spawn event fires) but then immediately exits.
      // After start(), verify we detect the close.
      await transport.start();

      // Wait for the close event
      await new Promise((r) => setTimeout(r, 200));
      expect(transport.isConnected).toBe(false);
    });

    it('should start a valid process', async () => {
      const transport = new StdioTransport({
        command: 'node',
        args: ['-e', 'process.stdin.resume(); setTimeout(() => {}, 10000)'],
      });

      await transport.start();
      expect(transport.isConnected).toBe(true);
      expect(transport.pid).toBeDefined();

      await transport.close();
    });

    it('should reject double start', async () => {
      const transport = new StdioTransport({
        command: 'node',
        args: ['-e', 'process.stdin.resume(); setTimeout(() => {}, 10000)'],
      });

      await transport.start();
      await expect(transport.start()).rejects.toThrow(/already started/);
      await transport.close();
    });
  });

  describe('send and receive', () => {
    it('should exchange JSON-RPC messages', async () => {
      // Create a simple echo server
      const script = `
        process.stdin.setEncoding('utf-8');
        let buf = '';
        process.stdin.on('data', (chunk) => {
          buf += chunk;
          const lines = buf.split('\\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            const resp = { jsonrpc: '2.0', id: msg.id, result: { echo: msg.method } };
            process.stdout.write(JSON.stringify(resp) + '\\n');
          }
        });
      `;

      const transport = new StdioTransport({
        command: 'node',
        args: ['-e', script],
      });

      await transport.start();

      const received: any[] = [];
      transport.onMessage((msg) => received.push(msg));

      await transport.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      });

      // Wait for response
      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(1);
      expect(received[0].id).toBe(1);
      expect(received[0].result.echo).toBe('test');

      await transport.close();
    });
  });

  describe('close', () => {
    it('should handle close of already-closed transport', async () => {
      const transport = new StdioTransport({ command: 'echo' });
      // Should not throw
      await transport.close();
    });

    it('should emit close event', async () => {
      const transport = new StdioTransport({
        command: 'node',
        args: ['-e', 'process.stdin.resume(); setTimeout(() => {}, 10000)'],
      });

      await transport.start();

      const closePromise = new Promise<number | null>((resolve) => {
        transport.onClose((code) => resolve(code));
      });

      await transport.close();
      const code = await closePromise;
      expect(transport.isConnected).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should emit error on stderr output', async () => {
      // Use a script that delays stderr so it fires after transport.start() resolves
      const transport = new StdioTransport({
        command: 'node',
        args: ['-e', 'setTimeout(() => process.stderr.write("test error\\n"), 100); process.stdin.resume(); setTimeout(() => {}, 5000)'],
      });

      const errors: Error[] = [];
      transport.onError((err) => errors.push(err));

      await transport.start();
      await new Promise((r) => setTimeout(r, 500));

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('test error');

      await transport.close();
    });

    it('should reject send when not connected', async () => {
      const transport = new StdioTransport({ command: 'echo' });
      await expect(transport.send({ jsonrpc: '2.0', method: 'test' })).rejects.toThrow(/not connected/i);
    });
  });
});
