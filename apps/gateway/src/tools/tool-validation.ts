/**
 * Runtime validation helper for tool arguments.
 *
 * MCP tool schemas are defined as plain objects mapping parameter names to
 * Zod schemas, but the framework delivers `args` as `Record<string, unknown>`.
 * This module bridges the gap by validating each argument against its Zod
 * schema at runtime, eliminating unsafe `as string` casts throughout the
 * tool layer.
 */
import type * as z from "zod";

/**
 * A tool schema definition: a record mapping parameter names to Zod schemas.
 * This mirrors the shape used by every `ITool.schema` in the gateway.
 */
export type ToolSchemaDefinition = Record<string, z.ZodTypeAny>;

/**
 * Infers a strongly-typed args object from a tool schema definition.
 *
 * @example
 * ```ts
 * const schema = { luaServerName: z.string(), limit: z.number().optional() };
 * type Args = InferToolArgs<typeof schema>;
 * // => { luaServerName: string; limit?: number | undefined }
 * ```
 */
export type InferToolArgs<T extends ToolSchemaDefinition> = {
  [K in keyof T]: z.infer<T[K]>;
};

/**
 * Validates raw tool arguments against a schema definition at runtime.
 *
 * Each key in `schema` is parsed independently using its Zod schema.
 * All validation errors are collected and thrown as a single error
 * with a descriptive message.
 *
 * @param schema - The tool's schema definition (param name → Zod schema)
 * @param args   - The raw arguments received from the MCP framework
 * @returns A strongly-typed object with all parameters validated
 * @throws Error if any parameter fails validation
 *
 * @example
 * ```ts
 * const validated = validateToolArgs(
 *   { luaServerName: luaServerNameSchema, luaToolName: luaToolNameSchema },
 *   args,
 * );
 * // validated.luaServerName is `string`, not `unknown`
 * ```
 */
export function validateToolArgs<T extends ToolSchemaDefinition>(
  schema: T,
  args: Record<string, unknown>,
): InferToolArgs<T> {
  const errors: string[] = [];
  const validated: Record<string, unknown> = {};

  for (const [key, zodSchema] of Object.entries(schema)) {
    const parseResult = zodSchema.safeParse(args[key]);
    if (parseResult.success) {
      validated[key] = parseResult.data;
    } else {
      const issues = parseResult.error.issues
        .map((issue) => issue.message)
        .join(", ");
      errors.push(`${key}: ${issues}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid tool arguments:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return validated as InferToolArgs<T>;
}
