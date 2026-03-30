import { injectable } from "inversify";
import type { ITool } from "./base-tool.js";
import type { ILogger } from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";

/**
 * Interface for the tool registry that manages all available tools.
 */
export interface IToolRegistry {
  /**
   * Register a new tool with the registry
   * @param tool - The tool to register
   */
  register: (tool: ITool) => void;

  /**
   * Get a tool by its name
   * @param name - The tool name
   * @returns The tool if found, undefined otherwise
   */
  get: (name: string) => ITool | undefined;

  /**
   * Get all registered tools
   * @returns Array of all registered tools
   */
  getAll: () => ITool[];
}

/**
 * Registry that manages all tools available in the gateway server.
 *
 * This registry follows the Open/Closed Principle - new tools can be added
 * without modifying existing code, just by registering them with the DI container.
 */
@injectable()
export class ToolRegistry implements IToolRegistry {
  private tools = new Map<string, ITool>();

  constructor(@$inject(TYPES.Logger) private readonly logger: ILogger) {}

  register(tool: ITool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(
        `Tool "${tool.name}" is already registered and will be overwritten`,
      );
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  getAll(): ITool[] {
    return Array.from(this.tools.values());
  }
}
