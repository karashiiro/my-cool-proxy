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

## Installation

### From npm (Recommended)

Install globally to use as a CLI tool:

```bash
npm install -g @karashiiro/my-cool-proxy
```

Or run directly without installing:

```bash
# Using pnpm (recommended)
pnpm dlx @karashiiro/my-cool-proxy

# Using npx
npx @karashiiro/my-cool-proxy
```

### From Source

Clone and build for development:

```bash
git clone https://github.com/karashiiro/my-cool-proxy.git
cd my-cool-proxy
pnpm install
pnpm build
```

## Quick Start

### 1. Configure

The gateway **auto-creates a default config** on first run. Just run it once to generate the config file:

```bash
my-cool-proxy  # Creates config and starts (with no servers)
```

Then edit the config to add your MCP servers:

```bash
# Find your config location
my-cool-proxy --config-path

# Edit to add servers (see CONFIG.md for all options)
```

Example config structure:

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

**Or**, copy the example config for a more complete starting point:

```bash
# Linux
mkdir -p ~/.config/my-cool-proxy
cp config.example.json ~/.config/my-cool-proxy/config.json

# macOS
mkdir -p ~/Library/Application\ Support/my-cool-proxy
cp config.example.json ~/Library/Application\ Support/my-cool-proxy/config.json

# Windows (PowerShell)
mkdir "$env:APPDATA\my-cool-proxy"
Copy-Item config.example.json "$env:APPDATA\my-cool-proxy\config.json"
```

### 2. Run

```bash
# If installed globally
my-cool-proxy

# If running from source
pnpm dev
```

### 3. Connect

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

### 4. Use It

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

Run the gateway as a stdio-based MCP server that clients launch directly. This is ideal when:

- You want the MCP client to manage the gateway process's lifecycle
- You're running everything locally and don't need a persistent server
- You prefer simpler deployment without managing an HTTP server, or your client doesn't support localhost HTTP (e.g. Claude Desktop)

**Key differences from HTTP mode:**

- Single session only (no multi-client support)
- All upstream MCP clients initialize at startup (not lazily)
- Must build before running (`pnpm dev` won't work - stdout is used for MCP protocol)

#### 1. Configure

The gateway auto-creates a config on first run, but for stdio mode you'll need to edit it to set `transport: "stdio"`. You can find your config location with `my-cool-proxy --config-path`.

Example config (port and host are ignored in stdio mode):

```json
{
  "transport": "stdio",
  "mcpClients": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

> **Tip:** Run `my-cool-proxy --config-path` to see exactly where your config should be located.

#### 2. Connect from MCP Client

Add to your MCP client config (e.g., Claude Desktop's `claude_desktop_config.json`):

**If installed globally via npm:**

```json
{
  "mcpServers": {
    "my-cool-proxy": {
      "command": "my-cool-proxy"
    }
  }
}
```

**If running from source (macOS/Linux):**

```json
{
  "mcpServers": {
    "my-cool-proxy": {
      "command": "node",
      "args": ["/absolute/path/to/my-cool-proxy/dist/index.js"]
    }
  }
}
```

**If running from source (Windows):**

```json
{
  "mcpServers": {
    "my-cool-proxy": {
      "command": "node",
      "args": ["C:\\Users\\yourname\\path\\to\\my-cool-proxy\\dist\\index.js"]
    }
  }
}
```

#### 3. Restart Your MCP Client

Restart Claude Desktop (or your MCP client) to pick up the new config. The gateway will start automatically when you begin a conversation.

#### Troubleshooting Stdio Mode

**Gateway not starting?**

- Check your MCP client's logs for error messages
- Verify the path to `dist/index.js` is correct and absolute
- Ensure you ran `pnpm build` after any code changes

**Config not found?**

- Run `my-cool-proxy --config-path` to see expected location
- Or set `CONFIG_PATH` environment variable to override:

```json
{
  "mcpServers": {
    "my-cool-proxy": {
      "command": "node",
      "args": ["path/to/my-cool-proxy/dist/index.js"],
      "env": {
        "CONFIG_PATH": "/path/to/your/config.json"
      }
    }
  }
}
```

**Upstream servers failing to connect?**

- All configured MCP clients must connect successfully at startup in stdio mode
- Check that commands in your config are correct and dependencies are installed
- Try running the upstream servers individually first to verify they work

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
