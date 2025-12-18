# my-cool-proxy

MCP gateway server that lets you call multiple MCP servers from Lua scripts.

## Quick Start

### 1. Install

```bash
pnpm install
```

### 2. Configure

Copy the example config:

```bash
cp config.example.json config.json
```

Edit `config.json` to add your MCP servers:

```json
{
  "port": 3000,
  "host": "localhost",
  "useOAuth": false,
  "mcpClients": {
    "my-server": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

### 3. Run

```bash
pnpm dev
```

### 4. Connect

Add to your MCP client config (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "my-cool-proxy": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### 5. Use It

The proxy exposes these tools:
- `execute` - Run Lua scripts that can call your configured MCP servers
- `list-servers` - See available servers
- `list-server-tools` - See tools for a server
- `tool-details` - Get full tool documentation

Example Lua script:

```lua
-- Call a tool on your MCP server
local result = my_server.some_tool({ arg = "value" }):await()

-- Return data
result = { data = result }
```

## Transport Types

**HTTP** - Connect to remote MCP servers:
```json
{
  "type": "http",
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

**Stdio** - Launch local MCP servers:
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"]
}
```

## Documentation

See [CONFIG.md](./CONFIG.md) for full configuration reference.

## Testing

```bash
pnpm test
```
