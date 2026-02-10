# Configuration Guide

This project uses a JSON-based configuration system with environment variable overrides.

## Configuration File Location

The gateway looks for `config.json` in the following locations (in priority order):

1. **Environment variable**: Path specified in `CONFIG_PATH`
2. **Platform-specific user directory**:
   - **Windows**: `%APPDATA%\my-cool-proxy\config.json`
   - **macOS**: `~/Library/Preferences/my-cool-proxy/config.json`
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
mkdir -p ~/Library/Preferences/my-cool-proxy
cp config.example.json ~/Library/Preferences/my-cool-proxy/config.json

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

## Sampling Security

**⚠️ SECURITY CRITICAL**: Sampling is a powerful capability that allows MCP servers to request the AI client to create messages. This effectively gives servers access to your system through the downstream client. **Sampling is disabled by default for all servers** to protect you from untrusted code.

### What is Sampling?

Sampling allows an MCP server to send `sampling/createMessage` requests that:

- Execute arbitrary prompts through your AI client
- Potentially access your filesystem, network, and other system resources
- Cannot be reliably scoped down by the gateway (the client decides what to allow)

This means **any server with sampling access can potentially interact with your system** in ways the gateway cannot control.

### Security Model

The gateway implements **defense-in-depth** to prevent untrusted servers from using sampling:

1. **Disabled by default**: All servers start without sampling access, even if your client supports it
2. **Explicit opt-in per server**: You must set `dangerouslyEnableSampling: true` for each trusted server
3. **Capability filtering**: Untrusted servers won't even know sampling exists (not advertised in capabilities)
4. **Handler blocking**: Even if a malicious server guesses that sampling exists, no handler will be registered to process its requests

### Configuration

The `dangerouslyEnableSampling` field is an optional boolean in your server configuration.

**Default (secure):**

```json
{
  "untrusted-server": {
    "type": "http",
    "url": "https://example.com/mcp"
  }
}
```

When `dangerouslyEnableSampling` is not specified (or is `false`), the server **cannot** make sampling requests, even if your client supports sampling.

**Explicitly enabled (use only for trusted servers):**

```json
{
  "trusted-server": {
    "type": "stdio",
    "command": "node",
    "args": ["my-trusted-server.js"],
    "dangerouslyEnableSampling": true
  }
}
```

Only enable sampling for servers you **fully trust with system access**. This server will be able to make `sampling/createMessage` requests that execute through your AI client.

### When to Enable Sampling

Only enable `dangerouslyEnableSampling: true` when **ALL** of these conditions are met:

1. **You trust the server code completely** - You've audited the source code or trust the author
2. **The server needs sampling** - The functionality you want requires `sampling/createMessage` requests
3. **You accept the security implications** - You understand the server can access your system through the client

### Mixed Trust Example

```json
{
  "mcpClients": {
    "public-docs": {
      "type": "http",
      "url": "https://docs.example.com/mcp",
      "allowedTools": ["search"]
    },
    "my-local-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["./my-server.js"],
      "dangerouslyEnableSampling": true
    },
    "experimental-server": {
      "type": "http",
      "url": "https://experimental.example.com/mcp"
    }
  }
}
```

In this configuration:

- `public-docs`: No sampling access (default-deny), limited to search tool
- `my-local-tools`: Sampling enabled (trusted local code)
- `experimental-server`: No sampling access (default-deny), untrusted

### ACP Shim Compatibility

If you configure an ACP shim (for clients that lack native sampling support), the per-server filtering **still applies**:

- The shim is initialized once per session (global resource)
- Access to the shim is controlled per-server (via `dangerouslyEnableSampling`)
- Only trusted servers can route requests through the shim
- Untrusted servers remain blocked, even though the shim exists

This means you can safely use the shim to provide sampling support, and the gateway will ensure only trusted servers can access it.

### Logging

The server logs helpful information about sampling configuration:

**When sampling is blocked:**

```
Sampling capability NOT advertised - dangerouslyEnableSampling not enabled for this server
NOT registering sampling handler for server 'untrusted-server' - dangerouslyEnableSampling not enabled
```

**When sampling is enabled:**

```
Advertising sampling capability to upstream (context: true, tools: true)
Registered sampling request handler for upstream server 'trusted-server'
```

### Summary

- **Default**: Sampling disabled for all servers (safe)
- **Opt-in**: Set `dangerouslyEnableSampling: true` per server (dangerous)
- **Trust model**: Only enable for servers you fully trust
- **Best practice**: Leave disabled unless you have a specific need

## Skills

Skills are reusable instruction sets that extend the gateway's capabilities. They can include scripts, reference materials, and specialized guidance for specific tasks.

**Skills are disabled by default** and must be explicitly enabled in your configuration.

### Configuration

```json
{
  "skills": {
    "enabled": true,
    "mutable": false
  }
}
```

#### Fields

- **enabled** (boolean, optional): Enable skill discovery and skill-related features. Default: `false`
  - When `true`, skills are exposed as MCP resources with the `gw-skill://` URI scheme
  - Also exposes the `invoke-gateway-skill-script` tool for running skill scripts
  - Includes a built-in "writing-gateway-skills" skill that explains how to create skills

- **mutable** (boolean, optional): Allow creating and modifying skills. Default: `false`
  - Only takes effect if `enabled` is `true`
  - When `true`, exposes the `write-gateway-skill` tool
  - When `false`, skills are read-only (can read via resources and invoke scripts, but not create/modify)

### Accessing Skills

Skills are exposed as MCP resources using the `gw-skill://` URI scheme:

- **`gw-skill://{skill-name}`** - Read the main SKILL.md content
- **`gw-skill://{skill-name}/{path}`** - Read nested resources (scripts/, references/, assets/)

Use the standard `resources/list` and `resources/read` MCP operations to discover and access skills.

### Available Tools

When skills are enabled, these tools become available:

| Tool                          | Requires                            | Description                                         |
| ----------------------------- | ----------------------------------- | --------------------------------------------------- |
| `invoke-gateway-skill-script` | `enabled: true`                     | Execute scripts from a skill's `scripts/` directory |
| `write-gateway-skill`         | `enabled: true` AND `mutable: true` | Create or modify skills and their files             |

### Skill Directory Structure

Skills are stored in the platform-specific config directory:

- **Windows**: `%APPDATA%\my-cool-proxy\skills\`
- **macOS**: `~/Library/Preferences/my-cool-proxy/skills/`
- **Linux**: `~/.config/my-cool-proxy/skills/`

Each skill lives in its own subdirectory:

```
skills/
  my-skill/
    SKILL.md              # Required - main content with YAML frontmatter
    scripts/              # Optional - executable scripts
      extract.py
    references/           # Optional - reference documentation
      API.md
    assets/               # Optional - data files
      template.json
```

### Example Configurations

**Read-only skills:**

```json
{
  "skills": {
    "enabled": true,
    "mutable": false
  }
}
```

Agents can load and use existing skills, but cannot create new ones or modify existing ones.

**Full skill management:**

```json
{
  "skills": {
    "enabled": true,
    "mutable": true
  }
}
```

Agents can create, modify, and use skills.

**Skills disabled (default):**

```json
{
  "skills": {
    "enabled": false
  }
}
```

Or simply omit the `skills` field entirely - skill-related tools will not be exposed.

## ACP (Agent Client Protocol)

The gateway can use an ACP agent to provide sampling capability when the downstream MCP client does not natively support it. This acts as a "shim" -- upstream MCP servers can send sampling requests even when connected through a client that lacks sampling support.

You can find a list of ACP agents [here](https://agentclientprotocol.com/get-started/agents).

### How It Works

| Client has sampling? | ACP agent configured? | Result                                |
| -------------------- | --------------------- | ------------------------------------- |
| Yes                  | Don't care            | Native sampling (existing behavior)   |
| No                   | Yes                   | ACP agent handles sampling            |
| No                   | No                    | Sampling disabled (existing behavior) |

When the shim activates:

1. The gateway spawns the configured ACP agent process
2. Upstream MCP servers are told that sampling is available
3. When an upstream server sends a sampling request, the gateway converts it to an ACP prompt and forwards it to the agent
4. The agent's response is converted back to MCP format and returned to the upstream server

Native client sampling always takes priority. If the downstream client supports sampling natively, the ACP agent is not used even if configured.

### Configuration

```json
{
  "acp": {
    "agent": {
      "command": "node",
      "args": ["path/to/acp-agent.js"],
      "env": {
        "MODEL": "gpt-4"
      }
    }
  }
}
```

#### Fields

- **acp** (object, optional): ACP configuration
  - **agent** (object, optional): ACP agent configuration for the sampling shim
    - **command** (string, required): Command to execute the ACP agent
    - **args** (array of strings, optional): Command-line arguments
    - **env** (object, optional): Environment variables to set for the agent process

### ACP Agent Requirements

The configured agent must:

- Communicate over stdio using the ACP ndjson protocol
- Implement the ACP `Agent` interface (initialize, newSession, prompt, cancel)
- Send responses via `sessionUpdate` notifications with `agent_message_chunk` content type

### Lifecycle

- One ACP agent process is spawned per gateway session (long-lived)
- One ACP session is created per sampling request (short-lived)
- The agent process is automatically killed when the gateway session closes

### Sampling Parameter Support

The ACP protocol does not expose LLM inference parameters (temperature, max tokens, etc.) at the prompt level -- agents manage their own model configuration internally. This means MCP sampling parameters cannot be forwarded natively to the ACP agent. The shim handles each `CreateMessageRequest` parameter as follows:

#### Mapped to ACP prompt content

| Parameter          | How it's mapped                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`messages`**     | Each message is serialized as a `[Role]: text` content block. Image and audio content is passed through natively when the ACP agent advertises support via `promptCapabilities`; otherwise, it falls back to a text placeholder like `[image: image/png]`. |
| **`systemPrompt`** | Prepended as a `[System]: {text}` content block before the messages. ACP has no native system prompt field, so this is informational context for the agent.                                                                                                |
| **`tools`**        | Supported via ephemeral MCP sidecar. Tools are exposed to the ACP agent through a stdio MCP server that proxies tool calls back to the gateway's upstream servers.                                                                                         |
| **`toolChoice`**   | Supported. `mode: "none"` filters out tools (sidecar not spawned). `mode: "required"` injects a prompt directive instructing the model to use tools. `mode: "auto"` is the default behavior with no special handling.                                      |

#### Included as informational text

These parameters are serialized into a `[Sampling parameters: ...]` text block appended to the prompt. The ACP agent may read and act on them, but is not obligated to. This block is only included when parameters beyond the required `maxTokens` are present.

| Parameter              | Serialized as                   |
| ---------------------- | ------------------------------- |
| **`maxTokens`**        | `maxTokens=200`                 |
| **`temperature`**      | `temperature=0.7`               |
| **`stopSequences`**    | `stopSequences=["STOP","END"]`  |
| **`modelPreferences`** | `modelPreferences={...}` (JSON) |

#### Not supported

| Parameter                 | Reason                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`includeContext`**      | No mechanism to inject MCP server context into an ACP session. The spec allows clients to ignore this parameter, and the values `thisServer`/`allServers` are soft-deprecated. |
| **`metadata`**            | Provider-specific LLM passthrough. ACP agents are not LLM providers, so there is no target for this data.                                                                      |
| **`task`**                | Task-augmented execution is not supported by the shim.                                                                                                                         |
| **`_meta.progressToken`** | The shim does not emit progress notifications.                                                                                                                                 |

#### Response mapping

| `CreateMessageResult` field | Value                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`role`**                  | Always `"assistant"`                                                                                                                                                                                                                                                          |
| **`content`**               | Merged from the ACP agent's response content blocks. When the response contains both text and non-text (image/audio) blocks, the first non-text block takes priority since `CreateMessageResult` only supports a single content block. Multiple text blocks are concatenated. |
| **`model`**                 | Always `"acp-agent"`. The actual model used by the agent is not exposed by the ACP protocol.                                                                                                                                                                                  |
| **`stopReason`**            | Mapped from ACP stop reasons: `end_turn` to `endTurn`, `max_tokens` to `maxTokens`, `stop_sequence` to `stopSequence`. Unknown reasons default to `endTurn`.                                                                                                                  |

### Security

The gateway connects to the ACP agent with minimal permissions:

- **Client capabilities**: Empty (`{}`) -- the agent cannot request file system access or terminal execution through the gateway
- **Permission requests**: All denied -- any tool permission requests from the agent are cancelled

This means the ACP agent is sandboxed to pure text/content generation through the shim. The agent may still use its own internal tools and capabilities, but cannot leverage the gateway as a proxy for privileged operations.

### ACP Filesystem Capabilities

By default, ACP agents cannot access the filesystem through the gateway. You can optionally enable sandboxed filesystem access to allow agents to read and write text files within their session's working directory.

**Configuration:**

```json
{
  "acp": {
    "agent": {
      "command": "node",
      "args": ["path/to/acp-agent.js"]
    },
    "filesystem": {
      "readTextFile": true,
      "writeTextFile": true
    }
  }
}
```

#### Fields

- **filesystem** (object, optional): Filesystem capabilities for ACP agents
  - **readTextFile** (boolean, optional): Enable reading text files. Default: `false`
  - **writeTextFile** (boolean, optional): Enable writing text files. Default: `false`

Both capabilities are disabled by default (secure by default). They can be enabled independently.

#### Security Model

When filesystem capabilities are enabled, the gateway enforces strict sandboxing:

| Security Control              | Implementation                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| **Session isolation**         | Each session has its own working directory (either from client's roots, or a temp directory) |
| **Path validation**           | All paths are canonicalized, normalized, and validated against an allowlist                  |
| **Path traversal prevention** | `..` and other escape attempts are blocked after canonicalization                            |
| **Symlink attack prevention** | For reads, symlinks are resolved to their real target and re-validated                       |
| **Parent directory check**    | For writes, the parent directory must exist and be within the sandbox                        |
| **Audit logging**             | Sandbox violations are logged at `warn` level                                                |

#### Example Sandbox Behavior

| Requested Path    | Working Directory | Result                                    |
| ----------------- | ----------------- | ----------------------------------------- |
| `file.txt`        | `/tmp/session-1/` | Allowed: `/tmp/session-1/file.txt`        |
| `subdir/file.txt` | `/tmp/session-1/` | Allowed: `/tmp/session-1/subdir/file.txt` |
| `../etc/passwd`   | `/tmp/session-1/` | Rejected: Path traversal attempt          |
| `/etc/passwd`     | `/tmp/session-1/` | Rejected: Absolute path outside sandbox   |
| `symlink-to-root` | `/tmp/session-1/` | Rejected: Symlink target outside sandbox  |
| `file.txt\0.jpg`  | `/tmp/session-1/` | Rejected: Null byte in path               |

#### Use Cases

Enable filesystem capabilities when:

- Running code editing agents that need to modify source files
- File generation tasks (creating templates, configs, etc.)
- Document processing within a controlled workspace

Keep filesystem disabled (default) when:

- Using agents for pure text generation or Q&A
- Running untrusted or experimental agents
- Minimizing attack surface
