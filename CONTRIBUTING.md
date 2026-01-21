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
   cp config.example.json config.json
   ```

   Edit `config.json` to add any MCP servers you want to test with. See [CONFIG.md](./CONFIG.md) for detailed configuration options.

3. **Start the development server:**
   ```bash
   pnpm dev
   ```
   The server starts on `http://localhost:3000/mcp`.

### Available Commands

- `pnpm dev` - Run development server with hot reload
- `pnpm build` - Compile TypeScript to `dist/` using tsgo
- `pnpm typecheck` - Run TypeScript type checking without emitting files
- `pnpm lint` - Run ESLint on all `.ts` and `.js` files
- `pnpm format` - Format all files with Prettier
- `pnpm test` - Run all tests with Vitest
- `pnpm test:watch` - Run tests in watch mode for development

## Development Workflow

### Before Making Changes

1. **Create a feature branch:**

   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Stay up to date:**
   ```bash
   git fetch upstream
   git pull --rebase upstream main
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
- Register all components in `src/container/inversify.config.ts`
- Use symbols from `src/types/index.ts` (TYPES) for injection tokens
- Decorate injectable classes with `@injectable()`

### Code Organization

- **Interfaces first:** Create interfaces for all major components
- **Single responsibility:** Each class/module should have one clear purpose
- **Configuration:** Use the config loader in `src/utils/config-loader.ts`
- **Logging:** Use the logger from `src/utils/logger.ts` instead of console.log

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

2. **Open a pull request on GitHub:**
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

- **Gateway Server** (`src/mcp/gateway-server.ts`) - Main MCP server wrapper
- **Client Manager** (`src/mcp/client-manager.ts`) - Manages MCP client connections
- **Lua Runtime** (`src/lua/runtime.ts`) - Executes Lua scripts with Wasmoon
- **DI Container** (`src/container/inversify.config.ts`) - Wires everything together

### Transport Modes

The proxy supports both the stdio and streamable HTTP transports (see `src/index.ts`):

**Streamable HTTP**:

- Uses `serveHttp()` from `@karashiiro/mcp` with session factory pattern
- Supports multiple concurrent sessions with isolated state
- Each session gets its own Gateway server instance via the session factory
- Clients are initialized on-demand when sessions start
- Each session gets its own set of MCP client instances (keyed as `${name}-${sessionId}`)
- Clients that don't support sessions use the `default` session

**stdio**:

- Uses `serveStdio()` from `@karashiiro/mcp`
- Single-session model (uses `default` as the session ID)
- All MCP clients initialized upfront during startup
- Reads from stdin, writes to stdout (incompatible with `pnpm dev`)
