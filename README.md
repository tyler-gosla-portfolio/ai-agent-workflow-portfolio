# Golem MCP Integration

TypeScript implementation of MCP (Model Context Protocol) client integration for the Golem CLI. Provides stdio transport, server lifecycle management, tool discovery/invocation, permission guards, and audit logging.

## Architecture

```
src/
  mcp/
    types.ts           - MCP protocol types (JSON-RPC 2.0, tools, resources, prompts)
    transport.ts       - Stdio transport (child process management)
    protocol.ts        - JSON-RPC protocol layer (request/response tracking, handshake)
    client.ts          - High-level MCP client (connect, list tools, call tools)
    server-manager.ts  - Server lifecycle (start/stop/restart/list)
    manifest.ts        - Server manifest and capability caching
    security.ts        - Permission guards, secret injection, audit logging
    router.ts          - Tool invocation routing across servers
  cli/
    index.ts           - CLI entry point (golem command)
    mcp-commands.ts    - golem mcp subcommand handlers
    formatter.ts       - Terminal output formatting
```

## Quick Start

```bash
npm install
npm run build
npm test
```

## CLI Usage

```bash
# Register an MCP server
golem mcp add myserver npx -y @modelcontextprotocol/server-everything

# Start it
golem mcp start myserver

# List servers and their status
golem mcp list

# Discover available tools
golem mcp tools myserver

# Call a tool
golem mcp call myserver.echo '{"message": "hello"}'

# View audit log
golem mcp audit

# Stop the server
golem mcp stop myserver
```

## Design

See [docs/DESIGN.md](docs/DESIGN.md) for the full system architecture and design specification.

## Testing

```bash
npm test              # Run all tests
npm test -- --watch   # Watch mode
```

111 tests across 9 test suites covering protocol, transport, client, server management, manifest, security, routing, CLI commands, and output formatting.
