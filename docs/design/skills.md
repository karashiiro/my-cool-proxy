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

This is separate from the `gw://` scheme used for upstream server resources. The `gw-skill://` scheme indicates gateway-local skills rather than proxied resources.

```mermaid
flowchart LR
    subgraph URIs["Resource URI Schemes"]
        GW["gw://server/uri"]
        Skill["gw-skill://skill-name"]
    end

    subgraph Sources["Resource Sources"]
        Upstream["Upstream MCP Servers"]
        Local["Local Skills Directory"]
    end

    GW --> Upstream
    Skill --> Local
```

## Discovery Workflow

Agents discover and use skills through standard MCP resource operations:

```mermaid
sequenceDiagram
    participant Agent
    participant Gateway
    participant Skills as Skills Directory

    Note over Agent,Skills: Step 1: Discover Available Skills
    Agent->>Gateway: list-resources()
    Gateway->>Skills: Scan skills directory
    Skills-->>Gateway: Available skills
    Gateway-->>Agent: Resources including gw-skill:// URIs

    Note over Agent,Skills: Step 2: Load Skill Content
    Agent->>Gateway: read-resource("gw-skill://code-review")
    Gateway->>Skills: Read SKILL.md
    Skills-->>Gateway: Skill content
    Gateway-->>Agent: Skill instructions

    Note over Agent,Skills: Step 3: (Optional) Execute Skill Script
    Agent->>Gateway: invoke-gateway-skill-script({skill: "code-review", script: "analyze.py"})
    Gateway->>Skills: Run scripts/analyze.py
    Skills-->>Gateway: Script output
    Gateway-->>Agent: Execution result
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

## Gateway Tools for Skills

When skills are enabled, these tools become available:

| Tool                          | Requires                                          | Description                                          |
| ----------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| `invoke-gateway-skill-script` | `skills.enabled: true`                            | Execute a script from a skill's `scripts/` directory |
| `write-gateway-skill`         | `skills.enabled: true` AND `skills.mutable: true` | Create or modify skills                              |

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

## Implementation Details

### Key Components

| Component                      | File                                            | Purpose                                         |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------- |
| `SkillDiscoveryService`        | `src/services/skill-discovery-service.ts`       | Scans skill directories, resolves skill content |
| `SkillResourceProvider`        | `src/services/skill-resource-provider.ts`       | Provides skills as MCP resources                |
| `InvokeGatewaySkillScriptTool` | `src/tools/invoke-gateway-skill-script-tool.ts` | Executes skill scripts                          |
| `WriteGatewaySkillTool`        | `src/tools/write-gateway-skill-tool.ts`         | Creates/modifies skills                         |

### Resource Integration

Skills integrate with the resource aggregation system:

```mermaid
flowchart TB
    subgraph Tools["Resource Tools"]
        ListRes["list-resources"]
        ReadRes["read-resource"]
    end

    subgraph Aggregation["Resource Aggregation Service"]
        Agg["Aggregates all resource providers"]
    end

    subgraph Providers["Resource Providers"]
        Upstream["Upstream MCP Servers<br/>(gw:// URIs)"]
        Skills["Skill Resource Provider<br/>(gw-skill:// URIs)"]
    end

    ListRes --> Agg
    ReadRes --> Agg
    Agg --> Upstream
    Agg --> Skills
```

## Built-in Skills

The gateway includes a built-in skill:

- **`writing-gateway-skills`** - Instructions for creating new skills, always available when skills are enabled

## Security Considerations

- Scripts execute in the gateway's process context
- Use `mutable: false` in production to prevent unauthorized skill modifications
- Review skill scripts before deploying to shared environments
