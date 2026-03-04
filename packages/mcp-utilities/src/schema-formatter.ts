/**
 * Formats a JSON Schema into human-readable lines showing field names,
 * types, required/optional status, and descriptions.
 *
 * @param schema - The JSON Schema object to format
 * @returns Array of formatted lines
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function formatSchema(schema: unknown, indent: number = 1): string[] {
  const lines: string[] = [];

  if (!schema || typeof schema !== "object") {
    return lines;
  }

  const schemaObj = schema as {
    type?: string | string[];
    properties?: Record<string, unknown>;
    required?: string[];
    description?: string;
  };

  const required = new Set(schemaObj.required || []);
  const pad = "  ".repeat(indent);
  const descPad = "  ".repeat(indent + 1);

  if (schemaObj.properties) {
    for (const [fieldName, fieldSchema] of Object.entries(
      schemaObj.properties,
    )) {
      const isRequired = required.has(fieldName);
      const fieldType = getSchemaType(fieldSchema);
      const requiredLabel = isRequired ? "required" : "optional";

      lines.push(`${pad}${fieldName} (${fieldType}, ${requiredLabel})`);

      const fieldSchemaObj = fieldSchema as {
        description?: string;
        properties?: Record<string, unknown>;
        items?: { properties?: Record<string, unknown> };
      };
      if (fieldSchemaObj.description) {
        lines.push(`${descPad}${fieldSchemaObj.description}`);
      }

      // Recursively expand nested object properties
      if (fieldSchemaObj.properties) {
        const nested = formatSchema(fieldSchema, indent + 1);
        if (nested.length > 0) {
          lines.push(...nested);
        }
      } else if (fieldSchemaObj.items && fieldSchemaObj.items.properties) {
        // Expand array item properties too
        lines.push(`${descPad}Item properties:`);
        const nested = formatSchema(fieldSchemaObj.items, indent + 2);
        if (nested.length > 0) {
          lines.push(...nested);
        }
      }
    }
  }

  return lines;
}

/**
 * Determines the type string for a schema field, handling arrays, enums,
 * objects, and primitive types.
 *
 * @param schema - The schema field to analyze
 * @returns A human-readable type string
 */
export function getSchemaType(schema: unknown): string {
  if (!schema || typeof schema !== "object") {
    return "unknown";
  }

  const schemaObj = schema as {
    type?: string | string[];
    items?: unknown;
    properties?: Record<string, unknown>;
    enum?: string[];
  };

  // Normalize type — JSON Schema allows type to be an array (e.g. ["null", "object"])
  let types: string[];
  if (Array.isArray(schemaObj.type)) {
    types = schemaObj.type;
  } else if (schemaObj.type) {
    types = [schemaObj.type];
  } else {
    types = [];
  }
  const nonNullTypes = types.filter((t) => t !== "null");
  const isNullable = types.includes("null");
  const primaryType = nonNullTypes[0];

  if (primaryType === "array" && schemaObj.items) {
    const itemType = getSchemaType(schemaObj.items);
    const base = `array<${itemType}>`;
    return isNullable ? `${base} | null` : base;
  }

  if (primaryType === "object" && schemaObj.properties) {
    return isNullable ? "object | null" : "object";
  }

  if (schemaObj.enum) {
    return `enum: ${schemaObj.enum.join(" | ")}`;
  }

  // For union types without special handling, join with pipe
  if (types.length > 1) {
    return types.join(" | ");
  }

  return primaryType || "unknown";
}
