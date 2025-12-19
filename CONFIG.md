# Configuration Guide

This project uses a JSON-based configuration system with environment variable overrides.

## Quick Start

1. Copy the example config:

   ```bash
   cp config.example.json config.json
   ```

2. Edit `config.json` with your settings

3. Run the server:
   ```bash
   pnpm dev
   ```

## Configuration File

By default, the server looks for `config.json` in the current working directory.

### Custom Config Path

You can specify a custom config file path using the `CONFIG_PATH` environment variable:

```bash
CONFIG_PATH=/path/to/custom-config.json pnpm dev
```

### Config Structure

```json
{
  "port": 3000,
  "host": "localhost",
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

- **port** (number, required): Port number for the server to listen on
- **host** (string, required): Hostname to bind to
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

- `port` must be a number
- `host` must be a string
- `mcpClients` must be an object (not an array)
- Each client must have a valid `type` ("http" or "stdio")
- HTTP clients must have a `url` field
- Stdio clients must have a `command` field
- `allowedTools` (if provided) must be an array of strings
- Config file must be valid JSON

If validation fails, the server will exit with a descriptive error message.

## Transport Types

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
