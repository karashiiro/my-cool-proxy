/**
 * Formats a JSON Schema into human-readable lines showing field names,
 * types, required/optional status, and descriptions.
 *
 * @param schema - The JSON Schema object to format
 * @returns Array of formatted lines
 */
export function formatSchema(schema: unknown): string[] {
  const lines: string[] = [];

  if (!schema || typeof schema !== "object") {
    return lines;
  }

  const schemaObj = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    description?: string;
  };

  const required = new Set(schemaObj.required || []);

  if (schemaObj.properties) {
    for (const [fieldName, fieldSchema] of Object.entries(
      schemaObj.properties,
    )) {
      const isRequired = required.has(fieldName);
      const fieldType = getSchemaType(fieldSchema);
      const requiredLabel = isRequired ? "required" : "optional";

      lines.push(`  ${fieldName} (${fieldType}, ${requiredLabel})`);

      const fieldSchemaObj = fieldSchema as { description?: string };
      if (fieldSchemaObj.description) {
        lines.push(`    ${fieldSchemaObj.description}`);
      }

      lines.push("");
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
    type?: string;
    items?: unknown;
    properties?: Record<string, unknown>;
    enum?: string[];
  };

  if (schemaObj.type === "array" && schemaObj.items) {
    const itemType = getSchemaType(schemaObj.items);
    return `array<${itemType}>`;
  }

  if (schemaObj.type === "object" && schemaObj.properties) {
    return "object";
  }

  if (schemaObj.enum) {
    return `enum: ${schemaObj.enum.join(" | ")}`;
  }

  return schemaObj.type || "unknown";
}
