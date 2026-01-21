import { injectable } from "inversify";
import type { ITool } from "./base-tool.js";

/**
 * Interface for the tool registry that manages all available tools.
 */
export interface IToolRegistry {
  /**
   * Register a new tool with the registry
   * @param tool - The tool to register
   */
  register(tool: ITool): void;

  /**
   * Get a tool by its name
   * @param name - The tool name
   * @returns The tool if found, undefined otherwise
   */
  get(name: string): ITool | undefined;

  /**
   * Get all registered tools
   * @returns Array of all registered tools
   */
  getAll(): ITool[];
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

  register(tool: ITool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  getAll(): ITool[] {
    return Array.from(this.tools.values());
  }
}
