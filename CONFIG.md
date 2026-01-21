# Configuration Guide

This project uses a JSON-based configuration system with environment variable overrides.

## Configuration File Location

The gateway looks for `config.json` in the following locations (in priority order):

1. **Environment variable**: Path specified in `CONFIG_PATH`
2. **Platform-specific user directory**:
   - **Windows**: `%APPDATA%\my-cool-proxy\config.json`
   - **macOS**: `~/Library/Application Support/my-cool-proxy/config.json`
   - **Linux**: `~/.config/my-cool-proxy/config.json` (respects `$XDG_CONFIG_HOME`)

## Automatic Config Creation

When you run the gateway for the first time without a config file, it **automatically creates a minimal default config** at the platform-specific location listed above.

The default config starts the gateway in HTTP mode with no MCP servers:

```json
{
  "port": 3000,
  "host": "localhost",
  "transport": "http",
  "mcpClients": {}
}
```

After creating the config, the gateway continues to start. You can then:

1. Edit the config file to add your MCP servers
2. Restart the gateway to pick up your changes

This eliminates the need to manually create the config directory and file for first-time setup.

### Finding Your Config Location

Run with `--config-path` to see all searched paths and which one will be used:

```bash
# After building
node dist/index.js --config-path

# Or with pnpm
pnpm build && node dist/index.js --config-path
```

### Setting Up Your Config

**Option 1: Auto-create (Recommended)**

Just run the gateway - it will automatically create a default config file:

```bash
my-cool-proxy  # Creates config and starts
```

Then edit the config to add your MCP servers (see [Config Structure](#config-structure) below).

**Option 2: Copy the example config**

For a more complete starting point with examples:

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

Then edit the config file with your settings and run the server:

```bash
pnpm dev
```

### Custom Config Path

You can override the default location using the `CONFIG_PATH` environment variable:

```bash
CONFIG_PATH=/path/to/custom-config.json pnpm dev
```

### Config Structure

```json
{
  "port": 3000,
  "host": "localhost",
  "transport": "http",
  "mcpClients": {
    "mcp-docs": {
      "type": "http",
      "url": "https://modelcontextprotocol.io/mcp"
    },
    "local-server": {
      "type": "stdio",
      "command": "node",
      "args": ["path/to/server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

#### Fields

- **port** (number, required for HTTP mode): Port number for the server to listen on
- **host** (string, required for HTTP mode): Hostname to bind to
- **transport** (string, optional): Gateway transport mode - `"http"` or `"stdio"` (default: `"http"`)
  - `"http"`: Run as HTTP server (requires port and host)
  - `"stdio"`: Run as stdio-based MCP server (port and host are optional)
- **mcpClients** (object, required): Map of MCP server configurations, keyed by server name

#### MCP Client Configuration

Each server in `mcpClients` is identified by its key (e.g., `"mcp-docs"`), which will be sanitized to a valid Lua identifier.

**HTTP Transport:**

```json
{
  "server-name": {
    "type": "http",
    "url": "https://example.com/mcp",
    "headers": {
      "Authorization": "Bearer your-token-here",
      "X-Custom-Header": "value"
    }
  }
}
```

- **type** (string): Must be `"http"`
- **url** (string): HTTP endpoint URL for the MCP server
- **headers** (object, optional): Custom HTTP headers to send with requests (e.g., for authentication)
- **allowedTools** (array, optional): List of tool names to expose from this server (see [Tool Filtering](#tool-filtering))

**Stdio Transport:**

```json
{
  "local-server": {
    "type": "stdio",
    "command": "node",
    "args": ["server.js"],
    "env": {
      "NODE_ENV": "production"
    }
  }
}
```

- **type** (string): Must be `"stdio"`
- **command** (string): Command to execute
- **args** (array, optional): Command-line arguments
- **env** (object, optional): Environment variables to set
- **allowedTools** (array, optional): List of tool names to expose from this server (see [Tool Filtering](#tool-filtering))

## Environment Variable Overrides

The following environment variables can override config file values:

- `PORT` - Override the port number
- `HOST` - Override the hostname
- `CONFIG_PATH` - Specify a custom config file path

### Example

```bash
PORT=8080 HOST=0.0.0.0 pnpm dev
```

This will use the config from `config.json` but override port and host.

## Priority Order

Configuration values are merged in this order (later values override earlier ones):

1. Config file (`config.json` or `CONFIG_PATH`)
2. Environment variables (`PORT`, `HOST`)

## Adding MCP Servers

To add additional MCP servers to your configuration:

```json
{
  "mcpClients": {
    "mcp-docs": {
      "type": "http",
      "url": "https://modelcontextprotocol.io/mcp"
    },
    "authenticated-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer secret-token"
      }
    },
    "my-custom-server": {
      "type": "http",
      "url": "http://localhost:8080/mcp"
    },
    "local-tool": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

Server names (the object keys) will be automatically sanitized to valid Lua identifiers:

- `mcp-docs` → `mcp_docs`
- `my.server` → `my_server`
- `api-v2` → `api_v2`

This sanitized name is what you'll use in your Lua scripts to access the server.

## Validation

The config loader validates:

- `transport` (if provided) must be "http" or "stdio"
- `port` must be a number (required for HTTP mode)
- `host` must be a string (required for HTTP mode)
- `mcpClients` must be an object (not an array)
- Each client must have a valid `type` ("http" or "stdio")
- HTTP clients must have a `url` field
- Stdio clients must have a `command` field
- `allowedTools` (if provided) must be an array of strings
- Config file must be valid JSON

If validation fails, the server will exit with a descriptive error message.

## Gateway Transport Mode

The `transport` field controls how the gateway **exposes itself** to MCP clients.

### HTTP Mode (Default)

Run the gateway as an HTTP server that clients connect to remotely.

**Configuration:**

```json
{
  "port": 3000,
  "host": "localhost",
  "transport": "http",
  "mcpClients": { ... }
}
```

**Usage:**

```bash
pnpm dev
# or for production:
pnpm build && node dist/index.js
```

**MCP Client Configuration:**

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

Run the gateway as a stdio-based MCP server that clients launch directly via command-line.

**Configuration:**

```json
{
  "transport": "stdio",
  "mcpClients": { ... }
}
```

Note: `port` and `host` are optional in stdio mode since the gateway doesn't run an HTTP server.

**Usage:**

```bash
pnpm build
```

**MCP Client Configuration:**

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

**Important:** Stdio mode requires building first - `pnpm dev` won't work properly with stdio since stdout is used for the MCP protocol.

## MCP Client Transport Types

### HTTP Transport

HTTP transport connects to MCP servers over HTTP.

```json
{
  "remote-api": {
    "type": "http",
    "url": "https://api.example.com/mcp"
  }
}
```

### Stdio Transport

Stdio transport launches a local process and communicates over standard input/output.

```json
{
  "local-tool": {
    "type": "stdio",
    "command": "node",
    "args": ["server.js"],
    "env": {
      "DEBUG": "true"
    }
  }
}
```

## Tool Filtering

By default, all tools from each MCP server are exposed to Lua scripts. You can optionally restrict which tools are available using the `allowedTools` field.

### Use Cases

- **Security**: Prevent sensitive tools from being accessible
- **Simplicity**: Reduce API surface area for simpler servers
- **Access Control**: Different server configurations for different environments

### Configuration

The `allowedTools` field is an optional array of tool names (strings) in your server configuration.

**All tools allowed (default):**

```json
{
  "my-server": {
    "type": "http",
    "url": "https://api.example.com/mcp"
  }
}
```

When `allowedTools` is not specified (or is `undefined`), all tools from the server are exposed.

**Specific tools allowed:**

```json
{
  "restricted-server": {
    "type": "http",
    "url": "https://api.example.com/mcp",
    "allowedTools": ["search", "get-document", "list-items"]
  }
}
```

Only the tools `search`, `get-document`, and `list-items` will be exposed. All other tools from this server will be blocked.

**No tools allowed:**

```json
{
  "locked-down-server": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem"],
    "allowedTools": []
  }
}
```

When `allowedTools` is an empty array (`[]`), the server connects but no tools are exposed. This can be useful for servers that you want to connect to but not actively use.

### Behavior

- **Case-sensitive matching**: Tool names must match exactly (e.g., `"search"` ≠ `"Search"`)
- **Non-blocking validation**: If a tool in `allowedTools` doesn't exist on the server, a warning is logged but startup continues
- **Filter transparency**: Both Lua runtime and gateway tools (like `list-server-tools`) automatically respect the filter

### Logging

The server logs helpful information about tool filtering:

**On startup (if filtering is configured):**

```
MCP client my-server configured with tool filter: search, get-document
```

```
MCP client locked-server configured with tool filter: all tools blocked
```

**When tools are filtered:**

```
Server 'my-server': Filtered to 2 of 15 tools: search, get-document
```

**When allowed tools don't exist:**

```
ERROR: Server 'my-server': Tool 'nonexistent-tool' in allowedTools not found. Available: search, get-document, list-items
```

### Example

```json
{
  "mcpClients": {
    "public-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "allowedTools": ["search", "list"]
    },
    "admin-api": {
      "type": "http",
      "url": "https://admin.example.com/mcp",
      "headers": {
        "Authorization": "Bearer admin-token"
      },
      "allowedTools": ["search", "list", "create", "update", "delete"]
    },
    "unrestricted-local": {
      "type": "stdio",
      "command": "node",
      "args": ["my-local-server.js"]
    }
  }
}
```

In this example:

- `public-api` only exposes safe read-only tools
- `admin-api` exposes additional administrative tools
- `unrestricted-local` exposes all tools (no filter)
