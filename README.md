# my-cool-proxy

MCP gateway server that lets you call multiple MCP servers from Lua scripts.

## Overview

This proxy acts as a gateway between AI agents and multiple MCP (Model Context Protocol) servers. Instead of connecting to each MCP server individually, agents connect to this single proxy and gain access to all configured servers through a unified interface.

**Progressive Tool Discovery:** Agents start with zero knowledge about what servers or tools are available. They build context progressively:

1. Call `list-servers` - The agent's context now includes names and descriptions of all available MCP servers (e.g., "github", "slack", "database")
2. Call `list-server-tools(server_name)` - The agent's context expands to include all tool names and descriptions for that specific server
3. Call `tool-details(server_name, tool_name)` - The agent's context now has complete parameter schemas, return types (if available), and usage examples for a specific tool
4. Call `execute(lua_script)` - With full context, the agent can write Lua scripts that call the discovered tools

Rather than loading all tools and tool descriptions into the context upfront, this defers loading tools until the agent determines those tools are needed.

**Tool Chaining with Lua:** Once an agent knows what tools exist, they can compose complex multi-step workflows in a single `execute()` call. The Lua runtime provides access to all discovered servers as globals, with tools callable as async functions.

**Sequential tool chaining:**

```lua
local raw_data = api_server.fetch({ id = 123 }):await()
local processed = processor.transform({ input = raw_data }):await()
result(processed)
```

**Conditional logic:**

```lua
local status = checker.validate({}):await()
if status.ok then
  result(processor.run({}):await())
else
  result(error_handler.notify({ error = status.message }):await())
end
```

**Iteration with loops:**

```lua
local results = {}
for i = 1, 5 do
  results[i] = worker.process({ index = i }):await()
end
result({ total = #results, data = results })
```

## Quick Start

### 1. Install

```bash
pnpm install
```

### 2. Configure

Create the config directory and copy the example config:

```bash
# Linux
mkdir -p ~/.config/my-cool-proxy
cp config.example.json ~/.config/my-cool-proxy/config.json

# macOS
mkdir -p ~/Library/Preferences/my-cool-proxy
cp config.example.json ~/Library/Preferences/my-cool-proxy/config.json

# Windows (PowerShell)
mkdir "$env:APPDATA\my-cool-proxy\Config"
Copy-Item config.example.json "$env:APPDATA\my-cool-proxy\Config\config.json"
```

Edit `config.json` to add your MCP servers (see [CONFIG.md](./CONFIG.md) for all options):

```json
{
  "port": 3000,
  "host": "localhost",
  "mcpClients": {
    "my-server": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

> **Tip:** Run `node dist/index.js --config-path` to see exactly where your config should be located.

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
-- Call a tool and return the result directly
result(my_server.some_tool({ arg = "value" }):await())

-- Or store in a variable first if you need to process it
local data = my_server.some_tool({ arg = "value" }):await()
result({ processed = data.something })
```

## MCP Client Transport Types

## Running the Gateway

The gateway supports two modes for how it exposes itself to MCP clients.

### HTTP Mode (Default)

Run the gateway as an HTTP server that clients connect to remotely:

**Configure** - Set `transport: "http"` in config.json (or omit for default):

```json
{
  "port": 3000,
  "host": "localhost",
  "transport": "http",
  "mcpClients": { ... }
}
```

**Run:**

```bash
pnpm dev
# or for production:
pnpm build && node dist/index.js
```

**Connect from MCP client:**

```json
{
  "mcpServers": {
    "my-cool-proxy": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Stdio Mode

Run the gateway as a stdio-based MCP server that clients launch directly:

**Configure** - Set `transport: "stdio"` in config.json (port and host are optional):

```json
{
  "transport": "stdio",
  "mcpClients": { ... }
}
```

**Build:**

```bash
pnpm build
```

**Connect from MCP client:**

```json
{
  "mcpServers": {
    "my-cool-proxy": {
      "command": "node",
      "args": ["path/to/my-cool-proxy/dist/index.js"]
    }
  }
}
```

**Note:** Stdio mode requires building first - `pnpm dev` won't work properly with stdio since stdout is used for the MCP protocol.

## MCP Client Transport Types

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
