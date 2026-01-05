# Known Issues

## Tool List Not Updated After Upstream Server Restart

**Status:** Open
**Severity:** Low (workaround available)

### Problem

When an upstream MCP server restarts and exposes new or modified tools, the gateway does not automatically detect these changes. The tool list remains cached from when the gateway first connected to that server.

### Symptoms

- New tools added to an upstream server don't appear in `list-server-tools` output
- Removed tools may still be listed (though calling them would fail)
- Tool schema changes are not reflected

### Current Workaround

Restart the gateway after restarting any upstream MCP server that has tool changes.

### Possible Solutions

1. **Periodic re-discovery:** Poll upstream servers on an interval to refresh tool lists
2. **On-demand refresh:** Add a `refresh-server-tools(server_name)` gateway tool that agents can call
3. **TTL-based cache:** Add expiration to the tool cache so it naturally refreshes after some time
4. **Event-based refresh:** If MCP protocol supports change notifications, subscribe to them

### Notes

The current behavior is a side effect of lazy client initialization and tool caching for performance. Any fix should balance freshness with the overhead of re-querying tool lists.
