import { describe, it, expect } from "vitest";
import { inferSchema } from "./schema-inferrer.js";
import { formatSchema } from "./schema-formatter.js";

/** Helper to navigate nested schema properties without `any` casts. */
function prop(
  schema: Record<string, unknown>,
  ...path: string[]
): Record<string, unknown> {
  let current = schema;
  for (const key of path) {
    const next = (
      current.properties as Record<string, Record<string, unknown>>
    )[key];
    if (!next) throw new Error(`Schema property '${key}' not found`);
    current = next;
  }
  return current;
}

describe("inferSchema", () => {
  describe("primitives", () => {
    it("should infer string type", () => {
      expect(inferSchema("hello")).toEqual({ type: "string" });
    });

    it("should infer number type", () => {
      expect(inferSchema(42)).toEqual({ type: "number" });
    });

    it("should infer boolean type", () => {
      expect(inferSchema(true)).toEqual({ type: "boolean" });
    });

    it("should infer null type", () => {
      expect(inferSchema(null)).toEqual({ type: "null" });
    });
  });

  describe("arrays", () => {
    it("should infer array of numbers", () => {
      expect(inferSchema([1, 2, 3])).toEqual({
        type: "array",
        items: { type: "number" },
        minItems: 3,
        maxItems: 3,
      });
    });

    it("should infer array of strings", () => {
      expect(inferSchema(["a", "b"])).toEqual({
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 2,
      });
    });

    it("should handle empty arrays", () => {
      expect(inferSchema([])).toEqual({
        type: "array",
        items: {},
        minItems: 0,
        maxItems: 0,
      });
    });

    it("should infer array of objects", () => {
      const result = inferSchema([
        { name: "foo", age: 42 },
        { name: "bar", age: 10 },
      ]);
      expect(result).toEqual({
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name", "age"],
        },
        minItems: 2,
        maxItems: 2,
      });
    });
  });

  describe("objects", () => {
    it("should infer object with primitive fields", () => {
      expect(inferSchema({ name: "foo", age: 42 })).toEqual({
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      });
    });

    it("should infer nested objects", () => {
      const result = inferSchema({
        user: { name: "foo", active: true },
      });
      expect(result).toEqual({
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              active: { type: "boolean" },
            },
            required: ["name", "active"],
          },
        },
        required: ["user"],
      });
    });

    it("should infer objects containing arrays of objects", () => {
      const result = inferSchema({
        items: [{ id: 1, name: "a" }],
        total: 1,
      });
      expect(result).toEqual({
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "number" },
                name: { type: "string" },
              },
              required: ["id", "name"],
            },
            minItems: 1,
            maxItems: 1,
          },
          total: { type: "number" },
        },
        required: ["items", "total"],
      });
    });
  });

  describe("depth limit", () => {
    it("should stop recursing at max depth for objects", () => {
      const deep = { a: { b: { c: { d: { e: "deep" } } } } };
      const result = inferSchema(deep, 2);
      expect(prop(result, "a", "b", "c")).toEqual({ type: "object" });
    });

    it("should stop recursing at max depth for arrays", () => {
      const deep = { a: { b: { c: [1, 2, 3] } } };
      const result = inferSchema(deep, 2);
      expect(prop(result, "a", "b", "c")).toEqual({ type: "array" });
    });

    it("should default to depth 4", () => {
      const deep = { a: { b: { c: { d: { e: "deep" } } } } };
      const result = inferSchema(deep);
      expect(prop(result, "a", "b", "c", "d")).toEqual({
        type: "object",
        properties: { e: { type: "string" } },
        required: ["e"],
      });
    });
  });

  describe("integration with formatSchema", () => {
    it("should produce readable text for array of objects", () => {
      const schema = inferSchema([{ id: 1, name: "foo", status: "active" }]);
      // The items schema is what we'd format
      const lines = formatSchema(schema.items as Record<string, unknown>);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => l.includes("id"))).toBe(true);
      expect(lines.some((l) => l.includes("name"))).toBe(true);
      expect(lines.some((l) => l.includes("status"))).toBe(true);
    });

    it("should produce readable text for objects", () => {
      const schema = inferSchema({ count: 10, label: "test" });
      const lines = formatSchema(schema);
      expect(lines.some((l) => l.includes("count"))).toBe(true);
      expect(lines.some((l) => l.includes("label"))).toBe(true);
    });
  });
});
