# Skills

Skills are reusable instruction sets that extend the gateway's capabilities for AI agents. They package process documentation, executable scripts, reference materials, and data assets into discoverable MCP resources.

## Why Skills?

AI agents often need structured guidance for complex tasks. Skills solve this by:

- **Reusability** - Write once, use across multiple sessions and agents
- **Discoverability** - Exposed as MCP resources that agents can find and load
- **Composability** - Skills can include scripts, references, and assets
- **Portability** - Skills live in standard directories, easy to share

## Skills as MCP Resources

Skills integrate with the gateway's resource system using a dedicated URI scheme:

```
gw-skill://{skill-name}              → Main SKILL.md content
gw-skill://{skill-name}/{path}       → Nested resources (scripts/, references/, assets/)
```

This is separate from upstream server resource URIs, which pass through **unchanged** (see [Resource Routing](./resource-namespacing.md)). The `gw-skill://` scheme indicates gateway-local skills rather than proxied resources.

```mermaid
flowchart LR
    subgraph URIs["Resource URI Schemes"]
        Upstream_URI["file:///..., custom://...<br/>(original URIs, unchanged)"]
        Skill["gw-skill://skill-name"]
    end

    subgraph Sources["Resource Sources"]
        Upstream["Upstream MCP Servers<br/>(routed via routing table)"]
        Local["Local Skills Directory"]
    end

    Upstream_URI --> Upstream
    Skill --> Local
```

## Discovery Workflow

Agents discover and use skills through Lua builtins within `execute` scripts:

```mermaid
sequenceDiagram
    participant Agent
    participant Gateway
    participant Lua as Lua Runtime
    participant Skills as Skills Directory

    Note over Agent,Skills: Step 1: Discover Available Skills
    Agent->>Gateway: execute({ script = "_gateway.list_resources():await()" })
    Gateway->>Lua: Execute script
    Lua->>Skills: Scan skills directory
    Skills-->>Lua: Available skills
    Lua-->>Gateway: Resources including gw-skill:// URIs
    Gateway-->>Agent: Resource list

    Note over Agent,Skills: Step 2: Load Skill Content
    Agent->>Gateway: execute({ script = "_gateway.read_resource({ uri = '...' }):await()" })
    Gateway->>Lua: Execute script
    Lua->>Skills: Read SKILL.md
    Skills-->>Lua: Skill content
    Lua-->>Gateway: Skill instructions
    Gateway-->>Agent: Skill content

    Note over Agent,Skills: Step 3: (Optional) Execute Skill Script
    Agent->>Gateway: execute({ script = "_gateway.invoke_skill_script({ ... }):await()" })
    Gateway->>Lua: Execute script
    Lua->>Skills: Run scripts/analyze.py
    Skills-->>Lua: Script output
    Lua-->>Gateway: Execution result
    Gateway-->>Agent: Result
```

## Skill Directory Structure

Skills are stored in the platform-specific config directory:

| Platform | Location                                      |
| -------- | --------------------------------------------- |
| Windows  | `%APPDATA%\my-cool-proxy\skills\`             |
| macOS    | `~/Library/Preferences/my-cool-proxy/skills/` |
| Linux    | `~/.config/my-cool-proxy/skills/`             |

Each skill is a subdirectory containing:

```
skills/
  code-review/
    SKILL.md              # Required - main content with YAML frontmatter
    scripts/              # Optional - executable scripts
      analyze.py
      lint.sh
    references/           # Optional - reference documentation
      CONVENTIONS.md
      API.md
    assets/               # Optional - data files
      config-template.json
      prompts.yaml
```

### SKILL.md Format

The main skill file uses YAML frontmatter followed by markdown content:

```markdown
---
name: code-review
description: Analyze code for quality, maintainability, and test coverage
---

# Code Review Skill

Instructions for the agent on how to perform code reviews...
```

## Lua Builtins for Skills

When skills are enabled, these Lua builtins become available in the `_gateway` global table (within `execute` scripts):

| Builtin                                 | Requires                                          | Description                                               |
| --------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| `_gateway.invoke_skill_script({ ... })` | `skills.enabled: true`                            | Execute a script from a skill's `scripts/` directory      |
| `_gateway.write_skill({ ... })`         | `skills.enabled: true` AND `skills.mutable: true` | Create or modify skills and their files                   |
| `_gateway.update_skill({ ... })`        | `skills.enabled: true` AND `skills.mutable: true` | Partially update a skill file using string replacement    |

Additionally, these builtins are always available (not skill-specific):

- `_gateway.list_resources()` - List all resources including skills
- `_gateway.read_resource({ uri = "..." })` - Read resources by URI (including `gw-skill://` URIs)
- `_gateway.summary_stats()` - Get gateway statistics

## Configuration

Skills are disabled by default. Enable them in your gateway configuration:

```json
{
  "skills": {
    "enabled": true,
    "mutable": false
  }
}
```

- **`enabled`**: When `true`, skills are exposed as MCP resources
- **`mutable`**: When `true`, agents can create and modify skills

See the [Configuration Guide](../configuration.md#skills) for detailed configuration options.

## Context Injection

Skills are surfaced to AI agents through MCP server instructions, which appear in the system prompt before every conversation turn. This provides agents with metadata about available skills without requiring explicit tool calls.

### How It Works

When the gateway initializes (or when a new HTTP session connects), the skill discovery service scans the skills directory and builds a manifest of available skills. This manifest is injected into the gateway's MCP `instructions` field, which MCP clients automatically surface in the agent's context.

```mermaid
sequenceDiagram
    participant Session as Session Init
    participant Discovery as Skill Discovery
    participant Preloader as ServerInfoPreloader
    participant Gateway as Gateway Server
    participant Client as MCP Client

    Session->>Discovery: discoverSkills()
    Discovery-->>Session: SkillMetadata[]
    Session->>Preloader: buildSkillInstructions(skills)
    Preloader-->>Session: Formatted instructions
    Session->>Gateway: new MCPGatewayServer(..., instructions)
    Gateway->>Client: MCP initialize response w/ instructions
    Note over Client: Instructions appear in agent context
```

### What Gets Injected

The injected instructions include:

1. **Skill name** - The identifier for `_gateway.read_resource()` calls
2. **Description** - Tells agents _when_ to load the skill (trigger conditions)
3. **Usage hints** - How to access skill content and nested resources

```xml
<available_skills>
  <skill>
    <name>code-review</name>
    <description>Use when reviewing code for quality...</description>
  </skill>
</available_skills>
```

The description field is critical: it determines when agents choose to load a skill. Poorly-written descriptions lead to skills being ignored or loaded at inappropriate times.

### Session-Scoped Discovery

In HTTP mode, skills are re-discovered for each new session. This enables runtime changes without gateway restarts:

1. Create a new skill with `_gateway.write_skill()`
2. Next session sees the new skill in its instructions
3. Existing sessions see the skill via `_gateway.list_resources()` but not in their original instructions

This tradeoff balances discoverability with performance (instruction injection happens once per session).

## Resources vs Lua Builtins: The Dual Interface

Skills are exposed through both MCP resources (`gw-skill://` URIs) and Lua builtins (`_gateway.list_resources()`, `_gateway.read_resource()`). This is intended to resolve an interoperability problem.

### The Problem: Inconsistent Resource Access

MCP clients handle resources differently; here are some examples:

| Client Behavior         | Example                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| **Manual attachment**   | User must explicitly add resources to context before the agent can see them |
| **Built-in discovery**  | Agent has native tools to list and read resources autonomously              |
| **No resource support** | Client only exposes tools, ignoring the resource protocol entirely          |

This inconsistency means skills-as-pure-resources would only work reliably in some environments. An agent using a "manual attachment" client would never discover skills on its own.

### The Solution: Lua Builtin Access

The gateway provides `_gateway.list_resources()` and `_gateway.read_resource()` as **Lua builtins**, accessible within `execute` scripts:

```mermaid
flowchart LR
    subgraph Native["MCP Resource Protocol"]
        R1["resources/list"]
        R2["resources/read"]
    end

    subgraph Builtins["Lua Builtins"]
        B1["_gateway.list_resources()"]
        B2["_gateway.read_resource()"]
    end

    subgraph Skills["Skill Resources"]
        S["gw-skill://..."]
    end

    Native --> Skills
    Builtins --> Skills

    Agent((Agent))
    Agent -.->|"Some clients"| Native
    Agent -->|"All clients<br/>(via execute)"| Builtins
```

Since all MCP clients support tools, agents can **always** discover and load skills by calling the gateway's `execute` tool with Lua scripts that use the `_gateway` builtins, regardless of how their client handles native resources.

### Complete Skill Interface

| Interface                                | Purpose                                         |
| ---------------------------------------- | ----------------------------------------------- |
| `_gateway.list_resources()` builtin      | Discover available skills (via execute)         |
| `_gateway.read_resource()` builtin       | Load skill content (via execute)                |
| `_gateway.invoke_skill_script()` builtin | Execute bundled scripts (via execute)           |
| `_gateway.write_skill()` builtin         | Create/modify skills when mutable (via execute) |
| Native `resources/list`                  | For clients with built-in resource support      |
| Native `resources/read`                  | For clients with built-in resource support      |

The native resource protocol handlers exist for clients that _do_ support resources well, but the Lua builtins ensure no agent is left behind.

## Implementation Details

### Key Components

| Component               | File                                                         | Purpose                                          |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `SkillDiscoveryService` | `apps/gateway/src/services/skill-discovery-service.ts`       | Scans skill directories, resolves skill content  |
| `SkillOperationsService`| `apps/gateway/src/services/skill-operations-service.ts`      | Creates, modifies, and updates skills            |
| `SkillResourceProvider` | `apps/gateway/src/services/skill-resource-provider.ts`       | Provides skills as MCP resources                 |
| `GatewayBuiltinsBuilder`| `apps/gateway/src/tools/gateway-builtins-builder.ts`         | Constructs `_gateway.*` builtins for skill ops   |

### Resource Integration

Skills integrate with the resource aggregation system:

```mermaid
flowchart TB
    subgraph Builtins["Lua Builtins"]
        ListRes["_gateway.list_resources()"]
        ReadRes["_gateway.read_resource()"]
    end

    subgraph Aggregation["Resource Aggregation Service"]
        Agg["Aggregates all resource providers"]
    end

    subgraph Providers["Resource Providers"]
        Upstream["Upstream MCP Servers<br/>(original URIs via routing table)"]
        Skills["Skill Resource Provider<br/>(gw-skill:// URIs)"]
    end

    ListRes --> Agg
    ReadRes --> Agg
    Agg --> Upstream
    Agg --> Skills
```

## Built-in Skills

The gateway includes a built-in skill:

- **`writing-gateway-skills`** - Instructions for creating new skills, available when `skills.mutable: true`

## Security Considerations

- Scripts execute in the gateway's process context
- Use `mutable: false` in production to prevent unauthorized skill modifications
- Review skill scripts before deploying to shared environments
