/**
 * Infers a JSON Schema from a runtime JavaScript value.
 *
 * Produces schema objects compatible with {@link formatSchema} for
 * human-readable rendering. Used by the result offloading feature to
 * show downstream clients the structure of large results without
 * sending the full payload.
 *
 * @param value - The value to infer a schema from
 * @param maxDepth - Maximum recursion depth (default 4). At the limit,
 *   objects become `{ type: "object" }` and arrays become `{ type: "array" }`.
 * @returns A JSON Schema object describing the value's structure
 */
export function inferSchema(
  value: unknown,
  maxDepth: number = 4,
): Record<string, unknown> {
  return infer(value, 0, maxDepth);
}

function infer(
  value: unknown,
  depth: number,
  maxDepth: number,
): Record<string, unknown> {
  if (value === null) {
    return { type: "null" };
  }

  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
  }

  if (Array.isArray(value)) {
    if (depth > maxDepth) {
      return { type: "array" };
    }

    const schema: Record<string, unknown> = {
      type: "array",
      items: value.length > 0 ? infer(value[0], depth + 1, maxDepth) : {},
      minItems: value.length,
      maxItems: value.length,
    };
    return schema;
  }

  if (typeof value === "object") {
    if (depth > maxDepth) {
      return { type: "object" };
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const properties: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      properties[key] = infer(val, depth + 1, maxDepth);
    }

    return {
      type: "object",
      properties,
      required: entries.map(([key]) => key),
    };
  }

  return { type: "unknown" };
}
