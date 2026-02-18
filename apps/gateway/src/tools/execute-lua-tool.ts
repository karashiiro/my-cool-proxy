import { injectable } from "inversify";
import { spawn } from "child_process";
import { resolve, sep } from "path";
import { existsSync, statSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { parse as parseYaml } from "yaml";
import type {
  CallToolResult,
  CompleteRequest,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import {
  ResourceAggregationService,
  PromptAggregationService,
  CompletionAggregationService,
  type IResourceRoutingService,
} from "@my-cool-proxy/mcp-aggregation";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
  ServerConfig,
  ISkillDiscoveryService,
  IGatewayBuiltins,
} from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import { getEffectiveSessionId } from "../utils/session.js";
import { getSkillsDir, SKILL_FILENAME } from "../utils/skills.js";

/**
 * Regular expression to extract YAML frontmatter from a markdown file.
 * Matches content between opening and closing `---` delimiters at the start of the file.
 */
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Expected shape of skill frontmatter after YAML parsing.
 */
interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Tool that executes Lua scripts with access to MCP servers.
 *
 * This tool allows executing arbitrary Lua code that can call tools on
 * available MCP servers. It's the primary way to orchestrate multi-server
 * tool calls.
 */
const BASE_DESCRIPTION = `Execute a Lua script that orchestrates tool calls across MCP servers. This is the primary way to use specialized tools discovered through this gateway.

WORKFLOW:
1. Call list-servers to discover available MCP servers
2. Call list-server-tools to see what each server provides
3. Call tool-details for each tool you plan to use (REQUIRED - brief descriptions are insufficient)
4. OPTIONAL: Call inspect-tool-response to see sample output structure for better data extraction
5. Call execute with a Lua script that uses those tools

SCRIPT SYNTAX:
- MCP servers are available as global variables using their Lua identifiers
- Tool calls return promises - use :await() to unwrap them
- Call result() to return a value from your script
- Example: result(server_name.tool_name({ arg = "value" }):await())

Most list/search tools paginate results. ALWAYS loop to fetch all pages — a single call typically returns only partial data:
\`\`\`lua
local all_items = {}
local page = 1
while true do
  local res = my_server.list_things({ page = page, perPage = 100 }):await()
  for _, item in ipairs(res.items) do
    table.insert(all_items, { name = item.name, id = item.id })
  end
  if not res.hasNextPage then break end
  page = page + 1
end
result(all_items)
\`\`\`

GATEWAY BUILTINS:
The \`_gateway\` global table provides built-in functions:
- _gateway.list_resources():await() - List all available resources across connected servers
- _gateway.list_resource_templates():await() - List all available resource templates. Use _gateway.complete() to discover valid values for template variables
- _gateway.read_resource({ uri = "..." }):await() - Read a resource by its URI (original upstream URI or gw-skill://)
- _gateway.list_prompts():await() - List all available prompts across connected servers
- _gateway.get_prompt({ name = "...", arguments = {...} }):await() - Get a prompt by namespaced name (server-name/prompt-name). Use _gateway.complete() to discover valid values for prompt arguments
- _gateway.complete({ ref = {...}, argument = { name = "...", value = "..." }, context = { arguments = {...} } }):await() - Get completions for a resource template variable (ref.type = "ref/resource", ref.uri = template URI) or prompt argument (ref.type = "ref/prompt", ref.name = namespaced prompt name). Pass partial value for fuzzy matching. Use context.arguments to provide other already-resolved variables for context-aware suggestions
- _gateway.summary_stats():await() - Get gateway statistics (server/tool/resource/prompt counts)`;

const SKILLS_NOTE = `

SKILLS:
Gateway skills are enabled. Before executing scripts, strongly consider checking for applicable skills
that may provide optimized workflows or best practices for your task.

Additional skill-related builtins in \`_gateway\`:
- _gateway.invoke_skill_script({ skillName = "...", script = "...", args = {...} }):await() - Execute a skill script
- _gateway.write_skill({ skillName = "...", content = "...", files = {...} }):await() - Create or modify a skill (when mutable)`;

@injectable()
export class ExecuteLuaTool implements ITool {
  readonly name = "execute";
  readonly description: string;

  readonly schema = {
    script: z
      .string()
      .describe(
        "Lua script to execute. See tool description for syntax and workflow.",
      ),
  };
  readonly annotations: ToolAnnotations = {
    title: "Execute Lua Script",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  };

  constructor(
    @$inject(TYPES.LuaRuntime) private luaRuntime: ILuaRuntime,
    @$inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @$inject(TYPES.Logger) private logger: ILogger,
    @$inject(TYPES.ServerConfig) private config: ServerConfig,
    @$inject(TYPES.ResourceAggregationService)
    private resourceAggregation: ResourceAggregationService,
    @$inject(TYPES.PromptAggregationService)
    private promptAggregation: PromptAggregationService,
    @$inject(TYPES.SkillDiscoveryService)
    private skillDiscoveryService: ISkillDiscoveryService,
    @$inject(TYPES.ResourceRoutingService)
    private routingService: IResourceRoutingService,
    @$inject(TYPES.CompletionAggregationService)
    private completionAggregation: CompletionAggregationService,
  ) {
    this.description =
      this.config.skills?.enabled === true
        ? BASE_DESCRIPTION + SKILLS_NOTE
        : BASE_DESCRIPTION;
  }

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const { script } = args;
    const sessionId = getEffectiveSessionId(context.sessionId);
    const mcpServers = this.clientPool.getClientsBySession(sessionId);
    const gatewayBuiltins = this.buildGatewayBuiltins(sessionId);

    try {
      const result = await this.luaRuntime.executeScript(
        script as string,
        mcpServers,
        gatewayBuiltins,
      );

      // Check if result is already a valid CallToolResult
      if (
        result &&
        typeof result === "object" &&
        "content" in result &&
        Array.isArray((result as Record<string, unknown>).content)
      ) {
        const parseResult = CallToolResultSchema.safeParse(result);
        if (parseResult.success) return parseResult.data;
      }

      // Return structured result if it's an object (but not an array)
      if (result !== null && typeof result === "object") {
        const textContent = {
          type: "text" as const,
          text: JSON.stringify(result),
        };

        // structuredContent must be a Record, not an array
        if (Array.isArray(result)) {
          return { content: [textContent] };
        }

        return {
          content: [textContent],
          structuredContent: result as Record<string, unknown>,
        };
      }

      // Return simple text result
      return {
        content: [
          {
            type: "text",
            text:
              result !== undefined
                ? `Script executed successfully.\n\nResult:\n${result}`
                : "Script executed successfully. No result returned.",
          },
        ],
      };
    } catch (error) {
      this.logger.error("Lua script execution failed:", error as Error);
      return {
        content: [{ type: "text", text: `Script execution failed:\n${error}` }],
        isError: true,
      };
    }
  }

  /**
   * Build gateway builtins object for the current session.
   * Includes conditional skill-related functions based on config.
   */
  private buildGatewayBuiltins(sessionId: string): IGatewayBuiltins {
    const builtins: IGatewayBuiltins = {
      listResources: async () => {
        const result = await this.resourceAggregation.listResources(sessionId);
        const resources = result.resources;

        if (resources.length === 0) {
          return { resources: [], message: "No resources available." };
        }

        // Return structured data
        return {
          totalResources: resources.length,
          resources: resources.map((r) => ({
            name: r.name,
            uri: r.uri,
            description: r.description,
            mimeType: r.mimeType,
          })),
        };
      },

      listResourceTemplates: async () => {
        const result =
          await this.resourceAggregation.listResourceTemplates(sessionId);
        const templates = result.resourceTemplates;

        if (templates.length === 0) {
          return {
            resourceTemplates: [],
            message: "No resource templates available.",
          };
        }

        return {
          totalTemplates: templates.length,
          resourceTemplates: templates.map((t) => ({
            name: t.name,
            uriTemplate: t.uriTemplate,
            description: t.description,
            mimeType: t.mimeType,
          })),
        };
      },

      readResource: async (uri: string) => {
        if (!uri || typeof uri !== "string") {
          return { error: "Missing required parameter: uri" };
        }

        try {
          const result = await this.resourceAggregation.readResource(
            uri,
            sessionId,
          );

          if (result.contents.length === 0) {
            return {
              uri,
              contents: [],
              message: "Resource returned no content.",
            };
          }

          // Return structured content
          return {
            uri,
            contents: result.contents.map((entry) => {
              if ("text" in entry) {
                return {
                  uri: entry.uri,
                  mimeType: entry.mimeType,
                  text: entry.text,
                };
              } else if ("blob" in entry) {
                return {
                  uri: entry.uri,
                  mimeType: entry.mimeType,
                  blobSize: ((entry.blob as string).length * 3) / 4,
                  note: "Binary content - base64 data available via blob field",
                };
              }
              return entry;
            }),
          };
        } catch (error) {
          const message = getErrorMessage(error);
          this.logger.error(
            `Failed to read resource '${uri}':`,
            error as Error,
          );
          return { error: `Failed to read resource '${uri}': ${message}` };
        }
      },

      listPrompts: async () => {
        const result = await this.promptAggregation.listPrompts(sessionId);
        const prompts = result.prompts;

        if (prompts.length === 0) {
          return { prompts: [], message: "No prompts available." };
        }

        return {
          totalPrompts: prompts.length,
          prompts: prompts.map((p) => ({
            name: p.name,
            description: p.description,
            arguments: p.arguments,
          })),
        };
      },

      getPrompt: async (name: string, args?: Record<string, string>) => {
        if (!name || typeof name !== "string") {
          return { error: "Missing required parameter: name" };
        }

        try {
          const result = await this.promptAggregation.getPrompt(
            name,
            args,
            sessionId,
          );
          return {
            name,
            description: result.description,
            messages: result.messages,
          };
        } catch (error) {
          const message = getErrorMessage(error);
          this.logger.error(`Failed to get prompt '${name}':`, error as Error);
          return { error: `Failed to get prompt '${name}': ${message}` };
        }
      },

      summaryStats: async () => {
        try {
          const clients = this.clientPool.getClientsBySession(sessionId);
          const failedServers = this.clientPool.getFailedServers(sessionId);

          const connectedCount = clients.size;
          const failedCount = failedServers.size;
          const totalServers = connectedCount + failedCount;

          // Count tools across all connected servers
          let totalTools = 0;
          const toolCountPromises = Array.from(clients.values()).map(
            async (client) => {
              try {
                const tools = await client.listTools();
                return tools.length;
              } catch {
                return 0;
              }
            },
          );
          const toolCounts = await Promise.all(toolCountPromises);
          totalTools = toolCounts.reduce((sum, count) => sum + count, 0);

          // Get resources count
          const resourcesResult =
            await this.resourceAggregation.listResources(sessionId);
          const totalResources = resourcesResult.resources.length;

          // Get prompts count
          const promptsResult =
            await this.promptAggregation.listPrompts(sessionId);
          const totalPrompts = promptsResult.prompts.length;

          // Get skills count
          let totalSkills = 0;
          if (this.config.skills?.enabled === true) {
            const skills = await this.skillDiscoveryService.discoverSkills();
            totalSkills = skills.length;
          }

          return {
            servers: {
              connected: connectedCount,
              failed: failedCount,
              total: totalServers,
            },
            tools: totalTools,
            resources: totalResources,
            prompts: totalPrompts,
            skills: totalSkills,
          };
        } catch (error) {
          this.logger.error("Failed to gather summary stats:", error as Error);
          return { error: `Failed to gather summary stats: ${error}` };
        }
      },

      complete: async (params: {
        ref: { type: string; uri?: string; name?: string };
        argument: { name: string; value: string };
        context?: { arguments?: Record<string, string> };
      }) => {
        if (!params?.ref || !params?.argument) {
          return { error: "Missing required parameters: ref and argument" };
        }

        const { ref, argument } = params;

        // Validate ref.type is a known completion reference type
        if (ref.type !== "ref/prompt" && ref.type !== "ref/resource") {
          return {
            error: `Invalid ref.type: '${String(ref.type)}'. Expected 'ref/prompt' or 'ref/resource'.`,
          };
        }

        // Validate discriminated union fields match the ref type
        if (ref.type === "ref/prompt" && typeof ref.name !== "string") {
          return {
            error:
              "ref.type is 'ref/prompt' but ref.name is missing or not a string.",
          };
        }
        if (ref.type === "ref/resource" && typeof ref.uri !== "string") {
          return {
            error:
              "ref.type is 'ref/resource' but ref.uri is missing or not a string.",
          };
        }

        // Validate argument structure
        if (
          typeof argument.name !== "string" ||
          typeof argument.value !== "string"
        ) {
          return {
            error: "argument.name and argument.value must both be strings.",
          };
        }

        try {
          return await this.completionAggregation.complete(
            params as CompleteRequest["params"],
            sessionId,
          );
        } catch (error) {
          const message = getErrorMessage(error);
          this.logger.error(`Failed to complete:`, error as Error);
          return { error: `Failed to complete: ${message}` };
        }
      },
    };

    // Add resource URI registration callback for tool result routing
    builtins.registerResourceUri = (uri: string, serverName: string) => {
      this.routingService.registerEncounteredUri(sessionId, uri, serverName);
    };

    // Add skill-related builtins conditionally
    if (this.config.skills?.enabled === true) {
      builtins.invokeSkillScript = async (
        skillName: string,
        script: string,
        args?: string[],
      ) => {
        return this.executeSkillScript(skillName, script, args ?? []);
      };

      if (this.config.skills?.mutable === true) {
        builtins.writeSkill = async (
          skillName: string,
          content?: string,
          files?: Array<{ path: string; content: string }>,
        ) => {
          return this.writeSkillFiles(skillName, content, files);
        };
      }
    }

    return builtins;
  }

  /**
   * Execute a script from a skill's scripts/ directory.
   * Adapted from InvokeGatewaySkillScriptTool.
   */
  private async executeSkillScript(
    skillName: string,
    script: string,
    scriptArgs: string[],
  ): Promise<unknown> {
    // Find the skill
    const skills = await this.skillDiscoveryService.discoverSkills();
    const skill = skills.find((s) => s.name === skillName);

    if (!skill) {
      this.logger.warn(`Skill not found for script execution: ${skillName}`);
      return {
        error: `Skill '${skillName}' not found. Check the available gateway skills.`,
      };
    }

    // Security: Validate script path
    if (script.includes("/") || script.includes("\\")) {
      this.logger.warn(
        `Invalid script name (contains path separator): ${script}`,
      );
      return {
        error: `Invalid script name: '${script}'. Provide only the filename, not a path.`,
      };
    }

    // Resolve the full path and verify it's in scripts/
    const scriptsDir = resolve(skill.path, "scripts");
    const scriptPath = resolve(scriptsDir, script);

    // Verify the resolved path is still within scripts/
    if (!scriptPath.startsWith(scriptsDir + sep)) {
      this.logger.warn(`Path traversal attempt in script name: ${script}`);
      return { error: `Invalid script name: '${script}'` };
    }

    // Check if the script exists and is a file
    if (!existsSync(scriptPath)) {
      this.logger.warn(`Script not found: ${scriptPath}`);
      return {
        error:
          `Script '${script}' not found in skill '${skillName}'. ` +
          `Make sure the script exists in the scripts/ directory.`,
      };
    }

    try {
      const stats = statSync(scriptPath);
      if (!stats.isFile()) {
        return { error: `'${script}' is not a file.` };
      }
    } catch {
      return { error: `Cannot access script '${script}'.` };
    }

    // Execute the script
    this.logger.info(
      `Executing skill script: ${skillName}/scripts/${script} with args: ${JSON.stringify(scriptArgs)}`,
    );

    try {
      const result = await this.runScript(scriptPath, scriptArgs, skill.path);
      return {
        stdout: result.stdout || undefined,
        stderr: result.stderr || undefined,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Script execution failed: ${errorMessage}`);
      return { error: `Script execution failed: ${errorMessage}` };
    }
  }

  /**
   * Run a script via shell.
   */
  private runScript(
    scriptPath: string,
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(scriptPath, args, {
        cwd,
        shell: true,
        env: {
          ...process.env,
          SKILL_DIR: cwd,
        },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        reject(error);
      });

      proc.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });
    });
  }

  /**
   * Create or modify a gateway skill.
   * Adapted from WriteGatewaySkillTool.
   */
  private async writeSkillFiles(
    skillName: string,
    content?: string,
    files?: Array<{ path: string; content: string }>,
  ): Promise<unknown> {
    // Validate that at least one of content or files is provided
    if (!content && (!files || files.length === 0)) {
      return {
        error:
          "At least one of 'content' (SKILL.md) or 'files' must be provided.",
      };
    }

    // Validate skill name (no path separators allowed)
    if (skillName.includes("/") || skillName.includes("\\")) {
      return {
        error: `Skill name '${skillName}' cannot contain path separators.`,
      };
    }

    // Validate frontmatter if content is provided
    if (content) {
      const frontmatterError = this.validateFrontmatter(content);
      if (frontmatterError) {
        return { error: frontmatterError };
      }
    }

    // Validate file paths (no path traversal)
    if (files) {
      for (const file of files) {
        const pathError = this.validateFilePath(file.path);
        if (pathError) {
          return { error: pathError };
        }
      }
    }

    try {
      // Create skill directory
      const skillsDir = getSkillsDir();
      const skillDir = resolve(skillsDir, skillName);

      // Ensure the skill directory exists
      if (!existsSync(skillDir)) {
        mkdirSync(skillDir, { recursive: true });
        this.logger.info(`Created skill directory: ${skillDir}`);
      }

      const writtenFiles: string[] = [];

      // Write SKILL.md if content is provided
      if (content) {
        const skillFilePath = resolve(skillDir, SKILL_FILENAME);
        writeFileSync(skillFilePath, content, "utf-8");
        writtenFiles.push(SKILL_FILENAME);
        this.logger.info(`Wrote SKILL.md for skill: ${skillName}`);
      }

      // Write additional files
      if (files) {
        for (const file of files) {
          const filePath = resolve(skillDir, file.path);
          const fileDir = dirname(filePath);

          // Ensure parent directory exists
          if (!existsSync(fileDir)) {
            mkdirSync(fileDir, { recursive: true });
          }

          writeFileSync(filePath, file.content, "utf-8");
          writtenFiles.push(file.path);
          this.logger.debug(`Wrote skill file: ${skillName}/${file.path}`);
        }
      }

      // Extract metadata from content or discover
      const metadata = await this.getSkillMetadata(
        skillName,
        skillDir,
        content,
      );

      this.logger.info(
        `Created/updated skill '${skillName}' with ${writtenFiles.length} file(s)`,
      );

      return {
        success: true,
        skill: {
          name: metadata.name,
          description: metadata.description,
        },
        writtenFiles,
        note:
          "Skill created successfully. It can be loaded immediately, " +
          "but won't appear in server instructions until the gateway is restarted.",
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(
        `Failed to write skill '${skillName}': ${errorMessage}`,
      );
      return { error: `Error writing skill: ${errorMessage}` };
    }
  }

  /**
   * Validate that content has valid YAML frontmatter.
   */
  private validateFrontmatter(content: string): string | undefined {
    const match = content.match(FRONTMATTER_REGEX);
    if (!match) {
      return (
        "SKILL.md content must include YAML frontmatter. " +
        "Expected format:\n---\nname: My Skill\ndescription: What it does\n---\n\n# Content here"
      );
    }

    const frontmatterYaml = match[1]!;
    try {
      const parsed = parseYaml(frontmatterYaml) as SkillFrontmatter;
      if (!parsed || typeof parsed !== "object") {
        return "YAML frontmatter is empty or not an object.";
      }
      // At least one of name or description should be present
      if (!parsed.name && !parsed.description) {
        return "YAML frontmatter should include at least a 'name' or 'description' field.";
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return `Invalid YAML in frontmatter: ${errorMessage}`;
    }

    return undefined;
  }

  /**
   * Validate that a file path is safe (no path traversal).
   */
  private validateFilePath(path: string): string | undefined {
    // Normalize path separators for the check
    const normalizedPath = path.replace(/\\/g, "/");

    // Check for path traversal attempts
    if (
      normalizedPath.startsWith("/") ||
      normalizedPath.startsWith("..") ||
      normalizedPath.includes("/../") ||
      normalizedPath.includes("/..") ||
      normalizedPath.endsWith("/..")
    ) {
      return `Invalid path '${path}' - path traversal is not allowed.`;
    }

    // Check for absolute Windows paths
    if (/^[a-zA-Z]:/.test(path)) {
      return `Invalid path '${path}' - absolute paths are not allowed.`;
    }

    return undefined;
  }

  /**
   * Get skill metadata either from provided content or by re-discovering.
   */
  private async getSkillMetadata(
    skillName: string,
    skillDir: string,
    content?: string,
  ): Promise<{ name: string; description: string; path: string }> {
    // If content was provided, extract metadata from it
    if (content) {
      const match = content.match(FRONTMATTER_REGEX);
      if (match) {
        try {
          const parsed = parseYaml(match[1]!) as SkillFrontmatter;
          return {
            name: parsed?.name || skillName,
            description: parsed?.description || "",
            path: skillDir,
          };
        } catch {
          // Fall through to default
        }
      }
    }

    // Try to discover from existing SKILL.md
    const skills = await this.skillDiscoveryService.discoverSkills();
    const discovered = skills.find(
      (s) => s.name === skillName || s.path === skillDir,
    );
    if (discovered) {
      return discovered;
    }

    // Return minimal metadata
    return {
      name: skillName,
      description: "",
      path: skillDir,
    };
  }
}
