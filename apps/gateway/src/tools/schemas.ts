/**
 * Shared Zod schemas for gateway tool parameters.
 *
 * This file centralizes commonly-used schema definitions to ensure
 * consistent parameter descriptions across tools.
 */
import * as z from "zod";

/**
 * Schema for Lua server name parameter.
 * Used by tools that need to identify an MCP server by its Lua identifier.
 */
export const luaServerNameSchema = z
  .string()
  .describe("The Lua identifier of the MCP server");

/**
 * Schema for Lua tool name parameter.
 * Used by tools that need to identify a specific tool by its Lua identifier.
 */
export const luaToolNameSchema = z
  .string()
  .describe("The Lua identifier of the tool");
