# Contributing to my-cool-proxy

Thank you for your interest in contributing to my-cool-proxy! This document will help you get started with development and understand our contribution process.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Codebase Conventions](#codebase-conventions)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Project Architecture](#project-architecture)

## Getting Started

### Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js** - v22 or higher
- **pnpm** - Preferably managed by Corepack: `corepack enable`

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/my-cool-proxy.git
   cd my-cool-proxy
   ```
3. Add the upstream repository (if not already handled by your tooling):
   ```bash
   git remote add upstream https://github.com/karashiiro/my-cool-proxy.git
   ```

## Development Setup

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Copy the example config file:**

   ```bash
   cp apps/gateway/config.example.json config.json
   ```

   Edit `config.json` to add any MCP servers you want to test with. See the [Configuration Guide](docs/configuration.md) for detailed configuration options.

3. **Start the development server:**
   ```bash
   pnpm dev
   ```
   The server starts on `http://localhost:3000/mcp`.

### Available Commands

- `pnpm dev` - Build all packages and run development server with hot reload
- `pnpm build` - Build all packages (gateway uses tsup for bundling)
- `pnpm typecheck` - Run TypeScript type checking across all packages
- `pnpm lint` - Run ESLint and Prettier checks
- `pnpm format` - Format all files with Prettier
- `pnpm test` - Run all tests with Vitest
- `pnpm test:unit` - Run unit tests only (excludes e2e)
- `pnpm test:e2e` - Run end-to-end tests only
- `pnpm test:e2e:http` - Run HTTP mode e2e tests
- `pnpm test:e2e:stdio` - Run stdio mode e2e tests
- `pnpm test:watch` - Run tests in watch mode for development
- `pnpm test:coverage` - Run tests with coverage report
- `pnpm check` - Run lint, typecheck, and test together

## Development Workflow

> **Note:** We use the `dev` branch for active development. The `main` branch is reserved for released code, so documentation and examples there always reflect the current release. Please base your work on `dev` and open PRs against it.

### Before Making Changes

1. **Create a feature branch from `dev`:**

   ```bash
   git checkout dev
   git checkout -b feat/your-feature-name
   ```

2. **Stay up to date:**
   ```bash
   git fetch upstream
   git pull --rebase upstream dev
   ```

### While Developing

1. **Run the dev server:**

   ```bash
   pnpm dev
   ```

2. **Run type checking:**

   ```bash
   pnpm typecheck
   ```

3. **Write tests for new functionality:**
   - Add tests in `*.test.ts` files
   - Run tests with `pnpm test` or `pnpm test:watch`

4. **Format your code:**

   ```bash
   pnpm format
   ```

5. **Check for linting errors:**
   ```bash
   pnpm lint
   ```

## Codebase Conventions

### Dependency Injection

- Use **Inversify** for dependency injection
- Register all components in `apps/gateway/src/container/inversify.config.ts`
- Use symbols from `apps/gateway/src/types/index.ts` (TYPES) for injection tokens
- Decorate injectable classes with `@injectable()`

### Code Organization

- **Interfaces first:** Create interfaces for all major components
- **Single responsibility:** Each class/module should have one clear purpose
- **Configuration:** Use the config loader in `apps/gateway/src/utils/config-loader.ts`
- **Logging:** Use the injected `ILogger` interface from `packages/logger/` instead of console.log

### Naming Conventions

- **Files:** Use kebab-case (e.g., `client-manager.ts`)
- **Classes:** Use PascalCase (e.g., `MCPClientManager`)
- **Interfaces:** Prefix with `I` (e.g., `IMCPClientManager`)
- **Variables/functions:** Use camelCase (e.g., `executeScript`)
- **Constants:** Use UPPER_SNAKE_CASE (e.g., `DEFAULT_PORT`)

## Testing

### Writing Tests

- Co-locate as `*.test.ts` files
- Use Vitest for all tests
- Follow the existing test structure for consistency

### Running Tests

```bash
# Run all tests once
pnpm test

# Run tests in watch mode (useful during development)
pnpm test:watch
```

## Submitting Changes

### Before Submitting

1. **Ensure all checks pass:**

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   ```

2. **Format your code:**

   ```bash
   pnpm format
   ```

3. **Commit your changes:**
   - Write clear, descriptive commit messages
   - Use conventional commit format when possible:
     - `feat: add WebSocket transport support`
     - `fix: handle Lua runtime errors gracefully`
     - `docs: update README with stdio mode info`
     - `test: add tests for client manager`
     - `refactor: simplify transport initialization`

### Creating a Pull Request

1. **Push your branch:**

   ```bash
   git push origin feat/your-feature-name
   ```

2. **Open a pull request on GitHub targeting the `dev` branch:**
   - Provide a clear title and description
   - Reference any related issues (e.g., "Fixes #123")
   - Describe what changed and why
   - Include any breaking changes or migration notes

3. **Respond to feedback:**
   - Be open to suggestions and code review
   - Make requested changes in new commits
   - Push updates to your branch (PR will update automatically)

### PR Checklist

- [ ] Code follows the style guidelines
- [ ] All tests pass (`pnpm test`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Code is formatted (`pnpm format`)
- [ ] Build succeeds (`pnpm build`)
- [ ] New code has tests
- [ ] Documentation is updated if needed
- [ ] Commit messages are clear and descriptive

## Project Architecture

### Key Components

- **Startup** (`apps/gateway/src/startup.ts`) - Initializes DI container, client connections, and starts transport/dashboard servers
- **Gateway Server** (`apps/gateway/src/mcp/gateway-server.ts`) - Main MCP server wrapper
- **Client Manager** (`packages/mcp-client/src/client-manager.ts`) - Manages MCP client connections
- **Lua Runtime** (`packages/lua-runtime/src/runtime.ts`) - Executes Lua scripts with Wasmoon
- **Dashboard** (`apps/gateway/src/dashboard/dashboard-server.ts`) - Optional web UI for execution history and session monitoring
- **DI Container** (`apps/gateway/src/container/inversify.config.ts`) - Wires everything together

### Transport Modes

The proxy supports both the stdio and streamable HTTP transports (see `apps/gateway/src/startup.ts`):

**Streamable HTTP**:

- Uses `serveHttp()` from `@karashiiro/mcp/http` with session factory pattern
- Supports multiple concurrent sessions with isolated state
- Each session gets its own Gateway server instance via the session factory
- Clients are initialized on-demand when sessions start
- Each session gets its own set of MCP client instances (keyed as `${name}-${sessionId}`)
- Clients that don't support sessions use the `default` session

**stdio**:

- Uses `serveStdio()` from `@karashiiro/mcp/stdio`
- Single-session model (uses `default` as the session ID)
- All MCP clients initialized upfront during startup
- Reads from stdin, writes to stdout (incompatible with `pnpm dev`)
