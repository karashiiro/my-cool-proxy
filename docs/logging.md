# Logging

## Gateway Application Log

The gateway writes structured log output to `gateway.log`:

- **Windows:** `%LOCALAPPDATA%\my-cool-proxy\Log\gateway.log`
- **macOS:** `~/Library/Logs/my-cool-proxy/gateway.log`
- **Linux:** `~/.local/state/my-cool-proxy/gateway.log`

This file is in structured JSON format (newline-delimited), suitable for machine processing with tools like `jq`. The default log level for the file is `trace`, which captures all messages including debug-level detail.

## Log Levels

The gateway has two independent output streams with separately configurable levels:

| Output                   | Format          | Default Level | Description             |
| ------------------------ | --------------- | ------------- | ----------------------- |
| **Console** (stderr)     | Human-readable  | `info`        | Visible in the terminal |
| **File** (`gateway.log`) | Structured JSON | `trace`       | Captures everything     |

Both streams can be configured independently via the `logging` section in `config.json`. See the [Configuration Guide](./configuration.md#logging-1) for details.

Setting the `QUIET_LOGS` environment variable reduces the default console level from `info` to `warn`.

## Upstream Server Logs

Stderr output from stdio MCP servers is redirected to log files. Log location varies by platform:

- **Windows:** `%LOCALAPPDATA%\my-cool-proxy\Log\servers\`
- **macOS:** `~/Library/Logs/my-cool-proxy/servers/`
- **Linux:** `~/.local/state/my-cool-proxy/servers/`

Each server gets its own log file: `{server-name}-{session-id}.log`. In stdio mode, the session ID is always `default` (e.g., `calculator-default.log`). In HTTP mode, `{session-id}` is a UUID-like MCP session identifier (e.g., `calculator-abc12345-....log`).

These logs are useful for debugging when upstream MCP servers encounter errors or when you want to see what stderr output they produce during operation.

## MCP Log Message Forwarding

Upstream `logging/message` notifications received from connected MCP servers are also written to the gateway's own log output (console and file), in addition to being relayed downstream to the client. This means server-side log messages appear in both the gateway log file and on the console, subject to the configured log levels.
