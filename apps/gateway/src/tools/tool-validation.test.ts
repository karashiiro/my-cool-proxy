import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateToolArgs } from "./tool-validation.js";

describe("validateToolArgs", () => {
  it("parses valid string args correctly", () => {
    const schema = { name: z.string() };
    const result = validateToolArgs(schema, { name: "hello" });
    expect(result).toEqual({ name: "hello" });
  });

  it("parses multiple params of different types", () => {
    const schema = {
      label: z.string(),
      count: z.number(),
      enabled: z.boolean(),
    };
    const result = validateToolArgs(schema, {
      label: "widgets",
      count: 7,
      enabled: true,
    });
    expect(result).toEqual({ label: "widgets", count: 7, enabled: true });
  });

  it("coerces values when using z.coerce", () => {
    const schema = {
      amount: z.coerce.number(),
    };
    const result = validateToolArgs(schema, { amount: "42" });
    expect(result).toEqual({ amount: 42 });
    expect(typeof result.amount).toBe("number");
  });

  it("throws when a required param is missing", () => {
    const schema = { name: z.string() };
    expect(() => validateToolArgs(schema, {})).toThrow();
  });

  it("throws with a descriptive message for wrong type", () => {
    const schema = { count: z.number() };
    expect(() => validateToolArgs(schema, { count: "not-a-number" })).toThrow(
      /count:/,
    );
  });

  it("collects ALL failures before throwing, not just the first", () => {
    const schema = {
      name: z.string(),
      age: z.number(),
      active: z.boolean(),
    };

    try {
      validateToolArgs(schema, { name: 123, age: "old", active: "nope" });
      expect.fail("should have thrown");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("name:");
      expect(message).toContain("age:");
      expect(message).toContain("active:");
    }
  });

  it("returns an empty object for empty schema and empty args", () => {
    const result = validateToolArgs({}, {});
    expect(result).toEqual({});
  });

  it("accepts undefined for optional params", () => {
    const schema = {
      title: z.string(),
      subtitle: z.string().optional(),
    };
    const result = validateToolArgs(schema, { title: "hi" });
    expect(result).toEqual({ title: "hi", subtitle: undefined });
  });

  it("error message starts with the expected prefix", () => {
    const schema = { name: z.string() };
    try {
      validateToolArgs(schema, { name: 42 });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/^Invalid tool arguments:\n/);
    }
  });
});
