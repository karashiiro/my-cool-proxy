import type { CompleteRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  ResourceAggregationService,
  PromptAggregationService,
  CompletionAggregationService,
  type IResourceRoutingService,
} from "@my-cool-proxy/mcp-aggregation";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import type {
  IMCPClientManager,
  ILogger,
  ServerConfig,
  ISkillDiscoveryService,
  ISkillOperationsService,
  IToolInspectionStore,
  IGatewayBuiltins,
} from "../types/interfaces.js";

/**
 * Builds the `_gateway` builtins object for a specific session.
 *
 * Plain class (not DI injectable) — instantiated per-call by ExecuteLuaTool
 * with its already-injected dependencies forwarded in. Each builtin lambda
 * closes over the provided `sessionId`.
 */
export class GatewayBuiltinsBuilder {
  constructor(
    private resourceAggregation: ResourceAggregationService,
    private promptAggregation: PromptAggregationService,
    private completionAggregation: CompletionAggregationService,
    private clientPool: IMCPClientManager,
    private routingService: IResourceRoutingService,
    private skillDiscoveryService: ISkillDiscoveryService,
    private skillOperations: ISkillOperationsService | null,
    private config: ServerConfig,
    private logger: ILogger,
    private toolInspectionStore: IToolInspectionStore,
  ) {}

  build(sessionId: string): IGatewayBuiltins {
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

    // Add tool call guard to enforce tool-details before execute
    builtins.toolCallGuard = (luaServerName: string, luaToolName: string) => {
      if (
        !this.toolInspectionStore.isInspected(
          sessionId,
          luaServerName,
          luaToolName,
        )
      ) {
        throw new Error(
          `Tool '${luaServerName}.${luaToolName}' cannot be called without prior inspection.\n\n` +
            `You MUST call tool-details (or inspect-tool-response) for this tool before using it in execute scripts.\n\n` +
            `Example:\n` +
            `  Call tool-details with luaServerName="${luaServerName}" and luaToolName="${luaToolName}"`,
        );
      }
    };

    // Add skill-related builtins conditionally
    if (this.skillOperations !== null) {
      const skillOps = this.skillOperations;

      builtins.invokeSkillScript = async (
        skillName: string,
        script: string,
        args?: string[],
      ) => {
        return skillOps.executeSkillScript(skillName, script, args ?? []);
      };

      if (this.config.skills?.mutable === true) {
        builtins.writeSkill = async (
          skillName: string,
          content?: string,
          files?: Array<{ path: string; content: string }>,
        ) => {
          return skillOps.writeSkillFiles(skillName, content, files);
        };

        builtins.updateSkill = async (
          skillName: string,
          file: string,
          oldString: string,
          newString: string,
          replaceAll?: boolean,
        ) => {
          return skillOps.updateSkillFile(
            skillName,
            file,
            oldString,
            newString,
            replaceAll,
          );
        };
      }
    }

    return builtins;
  }
}
