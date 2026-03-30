import type {
  Tool,
  Resource,
  ResourceTemplate as ResourceTemplateType,
  Prompt,
  ReadResourceResult,
  GetPromptResult,
  CompleteRequest,
  CompleteResult,
} from "@modelcontextprotocol/sdk/types.js";

export type { ILogger } from "@my-cool-proxy/logger";

/**
 * Cache service interface
 */
export interface ICacheService<T> {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
  delete: (key: string) => void;
  has: (key: string) => boolean;
  clear: () => void;
}

/**
 * Interface for MCP client sessions used by aggregation services.
 * This is a minimal subset of what the full MCPClientSession provides.
 */
export interface IMCPClientSession {
  /** List available tools from the MCP server */
  listTools: () => Promise<Tool[]>;

  /** List available resources from the MCP server */
  listResources: () => Promise<Resource[]>;

  /** Read a specific resource */
  readResource: (params: { uri: string }) => Promise<ReadResourceResult>;

  /** List available prompts from the MCP server */
  listPrompts: () => Promise<Prompt[]>;

  /** Get a specific prompt */
  getPrompt: (params: {
    name: string;
    arguments?: Record<string, string>;
  }) => Promise<GetPromptResult>;

  /** List available resource templates from the MCP server */
  listResourceTemplates: () => Promise<ResourceTemplateType[]>;

  /** Request completion suggestions for a prompt argument or resource template variable */
  complete: (params: CompleteRequest["params"]) => Promise<CompleteResult>;

  /** Get server version info */
  getServerVersion: () =>
    | { name?: string; version?: string; description?: string }
    | undefined;

  /** Get server instructions */
  getInstructions: () => string | undefined;
}

/**
 * Interface for MCP client manager used by aggregation services
 */
export interface IMCPClientManager {
  /** Get all clients for a session */
  getClientsBySession: (sessionId: string) => Map<string, IMCPClientSession>;

  /** Get all failed servers for a session */
  getFailedServers: (sessionId: string) => Map<string, string>;
}

/**
 * Gateway builtins interface for Lua runtime.
 * These are functions injected into the _gateway global table.
 */
export interface IGatewayBuiltins {
  listResources: () => Promise<unknown>;
  listResourceTemplates: () => Promise<unknown>;
  readResource: (uri: string) => Promise<unknown>;
  summaryStats: () => Promise<unknown>;
  invokeSkillScript?: (
    skillName: string,
    script: string,
    args?: string[],
  ) => Promise<unknown>;
  writeSkill?: (
    skillName: string,
    content?: string,
    files?: Array<{ path: string; content: string }>,
  ) => Promise<unknown>;
  registerResourceUri?: (uri: string, serverName: string) => void;
}

/**
 * Interface for Lua runtime used by tool discovery (for inspect-tool-response)
 */
export interface ILuaRuntime {
  /** Execute a Lua script with injected MCP servers and gateway builtins */
  executeScript: (
    script: string,
    mcpServers: Map<string, IMCPClientSession>,
    gatewayBuiltins: IGatewayBuiltins,
  ) => Promise<unknown>;
}

/**
 * Server list item for list-servers response
 */
export type ServerListItem =
  | {
      luaIdentifier: string;
      serverInfo: {
        name?: string;
        version?: string;
        description?: string;
        instructions?: string;
      };
    }
  | {
      luaIdentifier: string;
      error: string;
    };

/**
 * Tool info for list-server-tools response
 */
export interface ToolInfo {
  luaName: string;
  description: string;
}

/**
 * Interface for additional resource providers that can contribute to the
 * aggregated resource list. This allows the gateway to inject custom resources
 * (like skills) without coupling the aggregation package to specific logic.
 *
 * Providers are checked in order when reading resources, allowing them to
 * handle their own URI schemes (e.g., gw-skill:// for gateway skills).
 */
export interface IResourceProvider {
  /**
   * List all resources from this provider.
   * Called during resource aggregation alongside MCP server resources.
   */
  listResources: () => Promise<Resource[]>;

  /**
   * Read a resource by URI.
   * Called when a read request is made and `handlesUri()` returns true.
   *
   * @param uri - The resource URI to read
   * @returns The resource content, or null if not found
   * @throws Error if the resource exists but cannot be read
   */
  readResource: (uri: string) => Promise<ReadResourceResult | null>;

  /**
   * Check if this provider handles the given URI scheme.
   * Used to route read requests to the correct provider.
   *
   * @param uri - The resource URI to check
   * @returns true if this provider should handle the URI
   */
  handlesUri: (uri: string) => boolean;
}
