# Transport Modes

The MCP Gateway Proxy supports two transport modes: **HTTP** and **stdio**. This document explains how each mode works and when to use them.

## Overview

```mermaid
flowchart TB
    subgraph HTTP["HTTP Mode"]
        direction TB
        H1["Multi-session support"]
        H2["Lazy client initialization"]
        H3["SSE-based communication"]
        H4["Web API use cases"]
    end

    subgraph Stdio["Stdio Mode"]
        direction TB
        S1["Single session"]
        S2["Eager client initialization"]
        S3["Stdio-based communication"]
        S4["CLI tool use cases"]
    end
```

## HTTP Mode (Default)

HTTP mode runs the gateway as an HTTP server, supporting multiple concurrent sessions.

### How It Works

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Hono as Hono Server
    participant Session as Session Controller
    participant Transport as Transport Manager
    participant Gateway as Gateway Server
    participant Clients as Client Manager

    Note over Client,Clients: First Request (Session Start)
    Client->>Hono: GET /mcp (SSE connect)
    Hono->>Session: handleRequest()
    Session->>Transport: getOrCreateForRequest(sessionId)
    Note over Transport: Creates new transport<br/>for this session
    Transport-->>Session: WebStandardStreamableHTTPServerTransport
    Session->>Clients: initializeClientsForSession(sessionId)
    Note over Clients: Creates MCP clients<br/>for all configured servers
    Session->>Gateway: connect(transport)
    Note over Gateway: Registers tools,<br/>ready for requests
    Gateway-->>Client: SSE stream established

    Note over Client,Clients: Subsequent Requests
    Client->>Hono: POST /mcp (tool call)
    Hono->>Session: handleRequest()
    Session->>Transport: getOrCreateForRequest(sessionId)
    Note over Transport: Returns cached transport
    Transport-->>Session: Existing transport
    Session->>Gateway: (already connected)
    Gateway->>Gateway: Process tool call
    Gateway-->>Client: Result via SSE
```

### Key Characteristics

| Aspect | Description |
|--------|-------------|
| **Sessions** | Each client gets an isolated session identified by `mcp-session-id` header |
| **Client Init** | MCP clients created lazily when a session first makes a request |
| **Transport** | Uses `WebStandardStreamableHTTPServerTransport` from MCP SDK |
| **Endpoint** | Single `/mcp` endpoint handles GET (SSE), POST (messages), DELETE (cleanup) |

### Session ID Handling

1. Client sends `mcp-session-id` header with requests
2. If no header provided, a pending ID is generated: `pending-${timestamp}-${random}`
3. Session IDs are propagated to upstream MCP servers (unless pending or "default")
4. Transport manager caches transports keyed by session ID

### Configuration

```json
{
  "transport": "http",
  "port": 8080,
  "host": "localhost"
}
```

Environment overrides:
- `PORT` - Override the port
- `HOST` - Override the host

### When to Use HTTP Mode

- Web APIs serving multiple concurrent agents
- Cloud deployments
- Multi-tenant scenarios
- When you need session isolation

## Stdio Mode

Stdio mode runs the gateway as a stdio-based MCP server, typically launched by a client process.

### How It Works

```mermaid
sequenceDiagram
    participant Parent as Parent Process
    participant Gateway as Gateway (Child)
    participant Clients as Client Manager
    participant Upstream as Upstream MCP Servers

    Note over Parent,Upstream: Startup
    Parent->>Gateway: Launch via command
    Gateway->>Gateway: Load config
    Gateway->>Clients: initializeAllClients("default")
    loop For each configured server
        Clients->>Upstream: Connect
        Upstream-->>Clients: Connected
    end
    Gateway->>Gateway: Create StdioServerTransport
    Gateway->>Gateway: Connect to transport
    Note over Gateway: Ready for requests

    Note over Parent,Upstream: Runtime
    Parent->>Gateway: MCP message (via stdin)
    Gateway->>Gateway: Process request
    Gateway->>Clients: Forward tool calls
    Clients->>Upstream: MCP tool call
    Upstream-->>Clients: Result
    Clients-->>Gateway: Result
    Gateway->>Parent: MCP response (via stdout)
```

### Key Characteristics

| Aspect | Description |
|--------|-------------|
| **Sessions** | Single session with fixed ID "default" |
| **Client Init** | All MCP clients initialized eagerly at startup |
| **Transport** | Uses `StdioServerTransport` from MCP SDK |
| **Communication** | JSON-RPC over stdin/stdout |

### Configuration

```json
{
  "transport": "stdio"
}
```

Port and host settings are ignored in stdio mode.

### Important Limitations

- **Cannot use `pnpm dev`** - The development server uses stdout for logs, which conflicts with the MCP protocol
- **Must build first** - Run `pnpm build && node dist/index.js`
- **Single session only** - No concurrent clients supported

### When to Use Stdio Mode

- CLI tools that launch the gateway as a subprocess
- Single-agent scenarios
- Local development with Claude Desktop or similar clients
- When you don't need HTTP infrastructure

## Comparison

| Feature | HTTP Mode | Stdio Mode |
|---------|-----------|------------|
| Multiple sessions | Yes | No |
| Client initialization | Lazy | Eager |
| Session ID | From header | "default" |
| Development server | Works | Not supported |
| Typical use case | Web APIs | CLI tools |
| Transport | SSE/HTTP | stdin/stdout |

## Implementation Details

### Entry Point (`src/index.ts`)

The entry point reads the transport configuration and starts the appropriate mode:

```typescript
const config = loadConfig();
const container = createContainer(config);

if (config.transport === "stdio") {
  await startStdioMode(container);
} else {
  await startHttpMode(container, config);
}
```

### Transport Manager (`src/mcp/transport-manager.ts`)

HTTP mode only. Manages transport lifecycle:

- Creates `WebStandardStreamableHTTPServerTransport` instances
- Caches transports by session ID
- Handles cleanup when transports close
- Prevents race conditions during transport creation

### Session Controller (`src/controllers/mcp-session-controller.ts`)

HTTP mode only. Orchestrates request handling:

- Extracts session ID from headers
- Gets or creates transport for session
- Initializes clients for new sessions
- Connects gateway server to transport
- Delegates to transport for message handling

## Related Documentation

- [Session Management](./session-management.md) - How sessions and clients are managed
- [Index](./index.md) - High-level architecture overview
