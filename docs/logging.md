# Logging

Stderr output from stdio MCP servers is redirected to log files. Log location varies by platform:

- **Windows:** `%LOCALAPPDATA%\my-cool-proxy\Log\servers\`
- **macOS:** `~/Library/Logs/my-cool-proxy/servers/`
- **Linux:** `~/.local/state/my-cool-proxy/servers/`

Each server gets its own log file: `{server-name}-{session-id}.log`. In stdio mode, the session ID is always `default` (e.g., `calculator-default.log`).

These logs are useful for debugging when upstream MCP servers encounter errors or when you want to see what stderr output they produce during operation.
