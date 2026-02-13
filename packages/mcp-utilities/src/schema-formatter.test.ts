import { describe, it, expect } from "vitest";
import { formatSchema, getSchemaType } from "./schema-formatter.js";

describe("schema-formatter utilities", () => {
  describe("formatSchema", () => {
    it("should return empty array for null schema", () => {
      expect(formatSchema(null)).toEqual([]);
    });

    it("should return empty array for undefined schema", () => {
      expect(formatSchema(undefined)).toEqual([]);
    });

    it("should return empty array for non-object schema", () => {
      expect(formatSchema("string")).toEqual([]);
      expect(formatSchema(123)).toEqual([]);
      expect(formatSchema(true)).toEqual([]);
    });

    it("should return empty array for schema without properties", () => {
      expect(formatSchema({ type: "object" })).toEqual([]);
    });

    it("should format a simple object schema with required field", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      };

      const result = formatSchema(schema);

      expect(result).toContain("  name (string, required)");
    });

    it("should format a simple object schema with optional field", () => {
      const schema = {
        type: "object",
        properties: {
          age: { type: "number" },
        },
        required: [],
      };

      const result = formatSchema(schema);

      expect(result).toContain("  age (number, optional)");
    });

    it("should include field descriptions", () => {
      const schema = {
        type: "object",
        properties: {
          email: {
            type: "string",
            description: "The user email address",
          },
        },
      };

      const result = formatSchema(schema);

      expect(result).toContain("  email (string, optional)");
      expect(result).toContain("    The user email address");
    });

    it("should format multiple fields correctly", () => {
      const schema = {
        type: "object",
        properties: {
          firstName: { type: "string", description: "First name" },
          lastName: { type: "string", description: "Last name" },
          age: { type: "number" },
        },
        required: ["firstName", "lastName"],
      };

      const result = formatSchema(schema);

      expect(result).toContain("  firstName (string, required)");
      expect(result).toContain("    First name");
      expect(result).toContain("  lastName (string, required)");
      expect(result).toContain("    Last name");
      expect(result).toContain("  age (number, optional)");
    });

    it("should add empty lines between fields", () => {
      const schema = {
        type: "object",
        properties: {
          field1: { type: "string" },
          field2: { type: "number" },
        },
      };

      const result = formatSchema(schema);

      // Should have empty string entries between fields
      expect(result.filter((line) => line === "").length).toBeGreaterThan(0);
    });

    it("should handle schema without required array", () => {
      const schema = {
        type: "object",
        properties: {
          field: { type: "string" },
        },
        // no 'required' property
      };

      const result = formatSchema(schema);

      expect(result).toContain("  field (string, optional)");
    });
  });

  describe("getSchemaType", () => {
    it("should return 'unknown' for null schema", () => {
      expect(getSchemaType(null)).toBe("unknown");
    });

    it("should return 'unknown' for undefined schema", () => {
      expect(getSchemaType(undefined)).toBe("unknown");
    });

    it("should return 'unknown' for non-object schema", () => {
      expect(getSchemaType("string")).toBe("unknown");
      expect(getSchemaType(123)).toBe("unknown");
    });

    it("should return 'unknown' for schema without type", () => {
      expect(getSchemaType({})).toBe("unknown");
    });

    it("should return primitive types correctly", () => {
      expect(getSchemaType({ type: "string" })).toBe("string");
      expect(getSchemaType({ type: "number" })).toBe("number");
      expect(getSchemaType({ type: "integer" })).toBe("integer");
      expect(getSchemaType({ type: "boolean" })).toBe("boolean");
    });

    it("should return 'object' for object types with properties", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      expect(getSchemaType(schema)).toBe("object");
    });

    it("should return basic type for object without properties", () => {
      expect(getSchemaType({ type: "object" })).toBe("object");
    });

    it("should format array types with item type", () => {
      const schema = {
        type: "array",
        items: { type: "string" },
      };

      expect(getSchemaType(schema)).toBe("array<string>");
    });

    it("should format nested array types", () => {
      const schema = {
        type: "array",
        items: {
          type: "array",
          items: { type: "number" },
        },
      };

      expect(getSchemaType(schema)).toBe("array<array<number>>");
    });

    it("should format array of objects", () => {
      const schema = {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
        },
      };

      expect(getSchemaType(schema)).toBe("array<object>");
    });

    it("should return type for array without items", () => {
      const schema = { type: "array" };

      // When no items, just returns "array" as type
      expect(getSchemaType(schema)).toBe("array");
    });

    it("should format enum types", () => {
      const schema = {
        enum: ["red", "green", "blue"],
      };

      expect(getSchemaType(schema)).toBe("enum: red | green | blue");
    });

    it("should format enum with single value", () => {
      const schema = {
        enum: ["only"],
      };

      expect(getSchemaType(schema)).toBe("enum: only");
    });

    it("should prioritize array type over enum", () => {
      const schema = {
        type: "array",
        items: { type: "string" },
        enum: ["a", "b"],
      };

      expect(getSchemaType(schema)).toBe("array<string>");
    });

    it("should prioritize object type over enum", () => {
      const schema = {
        type: "object",
        properties: { field: { type: "string" } },
        enum: ["a", "b"],
      };

      expect(getSchemaType(schema)).toBe("object");
    });
  });
});
