# My Cool Proxy

[![NPM Version](https://img.shields.io/npm/v/%40karashiiro%2Fmy-cool-proxy)](https://www.npmjs.com/package/@karashiiro/my-cool-proxy)

My Cool Proxy is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server gateway that tries to solve a lot of perceived problems with MCP as it exists today. In no particular order, those are that:

- **Tool descriptions bloat the context window:** This is a problem with how most agents integrate with MCP. Rather than implementing abstractions that enable tools to be loaded as needed, most applications dump all MCP tools into the context at once. To mitigate this, My Cool Proxy wraps tools in a Lua interpreter and exposes higher-level tools for discovering tools incrementally. Refer to [Progressive Disclosure](#progressive-disclosure) for more information.
- **Tool results bloat the context window, why not use Bash?** Rather than using MCP tools, agents could just execute terminal commands and use bash to filter their results - however, this means allowing the agent to perform high-risk actions more frequently. For example, you could allow an agent to use the `gh` CLI to interact with GitHub, but it can then use the `gh` CLI to perform mutating or destructive operations, as well. With the [GitHub MCP Server](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md#url-path-parameters), you can instead scope things down to read-only tools trivially. MCP allows you to tightly control what tools agents have access to. To assist with this, My Cool Proxy allows you to [further filter](./docs/configuration.md#tool-filtering) the tools exposed to agents.
- **Most MCP features are unsupported:** Unfortunately, most applications only expose MCP tools to agents, neglecting the other [client](https://modelcontextprotocol.io/docs/learn/client-concepts) and [server](https://modelcontextprotocol.io/docs/learn/server-concepts) features offered by the protocol. My Cool Proxy aims to be a common abstraction layer for as many protocol features as possible, which allows developers to use the full capabilities of MCP in any MCP-compatible application. This is a work in progress - check the [feature support table](#mcp-feature-support-table) for more details.
- **Managing a config file for multiple agents is a pain:** If you use more than a single MCP-compatible application, you'll quickly run into challenges keeping your MCP server configuration synchronized across them. My Cool Proxy solves this by acting as a single integration point for every server you use, reducing the number of servers to keep in sync down to just one.

## Quick Start

### 0. Installation

Install it globally to use it as a CLI tool:

```bash
npm install -g @karashiiro/my-cool-proxy
```

Or run it directly via `npx`:

```bash
npx @karashiiro/my-cool-proxy
```

### 1. Configure

The gateway **auto-creates a default config** on first run. Just run it once to generate the config file:

```bash
my-cool-proxy  # Creates config and starts (with no servers)

# Find your config location
my-cool-proxy --config-path
```

Then [edit the config](docs/configuration.md) to add your MCP servers.

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

**Or**, copy the [example config](./apps/gateway/config.example.json) for a more complete starting point.

### 2. Run

```bash
# If installed globally
my-cool-proxy

# If running via npx
npx @karashiiro/my-cool-proxy
```

### 3. Connect

Add it to your MCP client config in e.g. Claude Desktop:

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

Ask your agent to perform a task that your configured MCP servers can help with, and watch it run!

## Progressive Disclosure

This proxy acts as a gateway between agents and multiple MCP (Model Context Protocol) servers. Instead of connecting to each MCP server individually, agents connect to this single proxy and gain access to all configured servers through a unified interface.

Agents start with minimal knowledge about what servers or tools are available. They build context progressively:

1. Check the server instructions - My Cool Proxy preloads a small prompt with brief excerpts of the configured servers and tools to prime the agent to use them.
2. Call `list-servers` - The agent's context now includes names and descriptions of all available MCP servers (e.g., "github", "slack", "database")
3. Call `list-server-tools(server_name)` - The agent's context expands to include all tool names and descriptions for that specific server
4. Call `tool-details(server_name, tool_name)` - The agent's context now has complete parameter schemas, return types (if available), and usage examples for a specific tool
5. Call `execute(lua_script)` - With full context, the agent can write Lua scripts that call the discovered tools

Rather than loading all tools and tool descriptions into the context upfront, this defers loading tools until the agent determines those tools are needed.

**Tool Chaining with Lua:** Once an agent knows what tools exist, they can compose complex multi-step workflows in a single `execute()` call, saving the context overhead of any intermediate tool results. The Lua runtime provides access to all discovered servers as globals, with tools callable as async functions.

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

## Gateway Skills

Gateway Skills are My Cool Proxy's implementation of [Agent Skills](https://agentskills.io) - reusable context documents that agents can load as [MCP Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources). When enabled, agents can:

- Discover skills via an automatically-injected prompt in the gateway's server instructions (or via the `_gateway.list_resources()` Lua builtin; look for `gw-skill://` URIs)
- Read skill content via the `_gateway.read_resource()` Lua builtin
- Execute skill scripts via the `_gateway.invoke_skill_script()` Lua builtin

While many agents implement their own skill systems already, these systems are highly fragmented, and it is difficult to reuse the same skills across multiple separate agent applications. While some systems such as [skills.sh](https://skills.sh) solve this by copying skills between applications explicitly, My Cool Proxy solves this by centralizing all skills into its own skill management system and exposing them over MCP. To distinguish these from existing skill systems, My Cool Proxy refers to these as "Gateway Skills."

Gateway Skills are disabled by default as they may conflict with existing skill systems built into your agent. See the [Configuration Guide](docs/configuration.md#skills) for setup options.

For a deeper design discussion about why Gateway Skills are implemented this way, refer to [this section](https://github.com/karashiiro/my-cool-proxy/blob/main/docs/design/skills.md#context-injection) in the design docs.

## Configuration

See the [Configuration Guide](docs/configuration.md) for the full config reference.

## MCP Feature Support Table

| Feature                                                                                             | Supported? | Details                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)                      | ✅         | My Cool Proxy expects tools to be supported at a bare minimum. Fortunately, everything that supports MCP supports tools.                                                                                                              |
| [Prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)                  | ✅         | My Cool Proxy forwards prompts from your MCP servers to the connected client and provides `_gateway.get_prompt()` and `_gateway.list_prompts()` Lua builtins for agents to load them within scripts.                                  |
| [Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)              | ✅         | My Cool Proxy both forwards resources from your MCP servers to the connected client and provides `_gateway.read_resource()` and `_gateway.list_resources()` Lua builtins for agents to load them within scripts.                      |
| Server Instructions                                                                                 | ✅         | My Cool Proxy loads excerpts of the instructions of connected MCP servers into its own server instructions, and also sends full copies through the `list-servers` tool when invoked.                                                  |
| Discovery Notifications                                                                             | ✅         | My Cool Proxy listens to the tool/prompt/resource change notifications of connected MCP servers to automatically update its own internal registries, which reflects in subsequent tool calls.                                         |
| [Completions](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion) | ❌         | Completions are not yet supported (but [will be](https://github.com/karashiiro/my-cool-proxy/issues/26) soon).                                                                                                                        |
| [Logging](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging)        | ✅         | My Cool Proxy forwards logging notifications to the connected client, and logs them itself as well.                                                                                                                                   |
| [Roots](https://modelcontextprotocol.io/specification/2025-11-25/client/roots)                      | ✅         | `roots/list` requests are forwarded from upstream servers to the downstream client. `notifications/roots/list_changed` notifications from the downstream client are fanned out to all upstream servers.                               |
| [Sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)                | ✅         | My Cool Proxy supports shimming sampling support over [ACP](https://agentclientprotocol.com/), though this is disabled by default. Refer to the [configuration docs](./docs/configuration.md#sampling-security) for more information. |
| [Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)          | ❌         | Elicitation is not yet supported (but [will be](https://github.com/karashiiro/my-cool-proxy/issues/20)).                                                                                                                              |
| [Progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress)       | ❌         | Progress is not yet supported (but [will be](https://github.com/karashiiro/my-cool-proxy/issues/25)).                                                                                                                                 |
| [Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)             | ⚠️         | Calling tools that support tasks is supported, but without leveraging the status updates for anything interesting. Sampling/elicitation tasks are not currently supported.                                                            |
| [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps)                                    | ❌         | MCP Apps are not yet supported (but [will be](https://github.com/karashiiro/my-cool-proxy/issues/29)).                                                                                                                                |
