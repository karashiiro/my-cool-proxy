import { describe, it, expect } from "vitest";
import { formatSchema, getSchemaType } from "./schema-formatter.js";

describe("getSchemaType", () => {
  it("should return 'unknown' for non-object types", () => {
    expect(getSchemaType(null)).toBe("unknown");
    expect(getSchemaType(undefined)).toBe("unknown");
    expect(getSchemaType("string")).toBe("unknown");
    expect(getSchemaType(42)).toBe("unknown");
  });

  it("should return basic type names", () => {
    expect(getSchemaType({ type: "string" })).toBe("string");
    expect(getSchemaType({ type: "number" })).toBe("number");
    expect(getSchemaType({ type: "boolean" })).toBe("boolean");
  });

  it("should handle array types", () => {
    expect(getSchemaType({ type: "array", items: { type: "string" } })).toBe(
      "array<string>",
    );
    expect(getSchemaType({ type: "array", items: { type: "number" } })).toBe(
      "array<number>",
    );
  });

  it("should handle nested array types", () => {
    expect(
      getSchemaType({
        type: "array",
        items: { type: "array", items: { type: "string" } },
      }),
    ).toBe("array<array<string>>");
  });

  it("should handle object types", () => {
    expect(getSchemaType({ type: "object", properties: {} })).toBe("object");
  });

  it("should handle enum types", () => {
    expect(getSchemaType({ enum: ["red", "green", "blue"] })).toBe(
      "enum: red | green | blue",
    );
  });

  it("should return 'unknown' for schema without type", () => {
    expect(getSchemaType({})).toBe("unknown");
  });
});

describe("formatSchema", () => {
  it("should return empty array for non-object types", () => {
    expect(formatSchema(null)).toEqual([]);
    expect(formatSchema(undefined)).toEqual([]);
    expect(formatSchema("string")).toEqual([]);
  });

  it("should return empty array for schema without properties", () => {
    expect(formatSchema({ type: "string" })).toEqual([]);
    expect(formatSchema({})).toEqual([]);
  });

  it("should format simple schema with one required field", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", description: "The user's name" },
      },
      required: ["name"],
    };

    const result = formatSchema(schema);
    expect(result).toContain("  name (string, required)");
    expect(result).toContain("    The user's name");
  });

  it("should format schema with optional fields", () => {
    const schema = {
      type: "object",
      properties: {
        age: { type: "number", description: "The user's age" },
      },
    };

    const result = formatSchema(schema);
    expect(result).toContain("  age (number, optional)");
    expect(result).toContain("    The user's age");
  });

  it("should format schema with multiple fields", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", description: "User name" },
        age: { type: "number", description: "User age" },
        active: { type: "boolean" },
      },
      required: ["name"],
    };

    const result = formatSchema(schema);
    expect(result).toContain("  name (string, required)");
    expect(result).toContain("  age (number, optional)");
    expect(result).toContain("  active (boolean, optional)");
  });

  it("should format schema with array fields", () => {
    const schema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "List of tags",
        },
      },
      required: ["tags"],
    };

    const result = formatSchema(schema);
    expect(result).toContain("  tags (array<string>, required)");
    expect(result).toContain("    List of tags");
  });

  it("should format schema with enum fields", () => {
    const schema = {
      type: "object",
      properties: {
        status: {
          enum: ["active", "inactive", "pending"],
          description: "Status value",
        },
      },
    };

    const result = formatSchema(schema);
    expect(result).toContain(
      "  status (enum: active | inactive | pending, optional)",
    );
    expect(result).toContain("    Status value");
  });

  it("should format schema with object fields", () => {
    const schema = {
      type: "object",
      properties: {
        metadata: {
          type: "object",
          properties: {},
          description: "Additional metadata",
        },
      },
    };

    const result = formatSchema(schema);
    expect(result).toContain("  metadata (object, optional)");
    expect(result).toContain("    Additional metadata");
  });

  it("should handle fields without descriptions", () => {
    const schema = {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    };

    const result = formatSchema(schema);
    expect(result).toContain("  id (string, required)");
    // Should have empty line after field name
    const idIndex = result.findIndex((line) =>
      line.includes("id (string, required)"),
    );
    expect(result[idIndex + 1]).toBe("");
  });

  it("should add empty lines between fields", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    };

    const result = formatSchema(schema);
    // Each field should be followed by an empty line
    expect(result.filter((line) => line === "").length).toBeGreaterThan(0);
  });
});
