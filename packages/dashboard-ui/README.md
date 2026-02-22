# @my-cool-proxy/dashboard-ui

SvelteKit web UI for the My Cool Proxy gateway dashboard. Provides a browser-based interface for browsing Lua execution history, viewing tool calls, and monitoring active sessions.

## Features

- **Execution list** — Paginated view of all Lua script executions with timing and status
- **Execution detail** — Syntax-highlighted Lua scripts and JSON results (via Shiki)
- **Tool call log** — See which MCP server tools were called during each execution
- **Session overview** — Active sessions with connected servers, capabilities, and working directories
- **Real-time updates** — WebSocket connection streams new executions and tool calls as they happen
- **Tool filter** — Filter executions by specific server/tool combinations

## Development

From the monorepo root:

```bash
# Build all packages (including dashboard-ui)
pnpm build

# Run the gateway with dashboard enabled
pnpm dev
```

Or from this package directory:

```bash
# Development server with hot reload
pnpm run dev

# Production build
pnpm run build

# Preview production build
pnpm run preview
```

## How It Integrates

The gateway's build step (`tsup.config.ts`) copies the SvelteKit static output from this package's `build/` directory into `dist/dashboard/`. The gateway then serves these files when the `dashboard` config option is set. See the [Configuration Guide](../../docs/configuration.md#dashboard) for setup.

## Tech Stack

- [SvelteKit](https://svelte.dev/docs/kit) with Svelte 5
- [Tailwind CSS](https://tailwindcss.com) for styling
- [Shiki](https://shiki.style) for syntax highlighting
- [@sveltejs/adapter-static](https://svelte.dev/docs/kit/adapter-static) for static site generation
