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
result = processed
```

**Conditional logic:**

```lua
local status = checker.validate({}):await()
if status.ok then
  result = processor.run({}):await()
else
  result = error_handler.notify({ error = status.message }):await()
end
```

**Iteration with loops:**

```lua
local results = {}
for i = 1, 5 do
  results[i] = worker.process({ index = i }):await()
end
result = { total = #results, data = results }
```

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
