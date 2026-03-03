import { describe, it, expect } from "vitest";
import { maybeOffloadResult } from "./result-offloader.js";

describe("maybeOffloadResult", () => {
  const EXEC_ID = "1709472000000_abc123";

  it("should return null for undefined result", () => {
    expect(maybeOffloadResult(undefined, EXEC_ID, 100)).toBeNull();
  });

  it("should return null for null result", () => {
    expect(maybeOffloadResult(null, EXEC_ID, 100)).toBeNull();
  });

  it("should return null when threshold is 0 (disabled)", () => {
    const large = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    expect(maybeOffloadResult(large, EXEC_ID, 0)).toBeNull();
  });

  it("should return null when result is under threshold", () => {
    expect(maybeOffloadResult({ a: 1 }, EXEC_ID, 50_000)).toBeNull();
  });

  it("should return null when result size equals threshold exactly", () => {
    const data = { x: "a" };
    const exactSize = JSON.stringify(data).length; // e.g. 9
    expect(maybeOffloadResult(data, EXEC_ID, exactSize)).toBeNull();
  });

  it("should offload when result is one byte over threshold", () => {
    const data = { x: "a" };
    const justUnder = JSON.stringify(data).length - 1;
    const result = maybeOffloadResult(data, EXEC_ID, justUnder);
    expect(result).not.toBeNull();
  });

  it("should offload array of objects exceeding threshold", () => {
    const large = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      status: "active",
    }));
    const result = maybeOffloadResult(large, EXEC_ID, 100);

    expect(result).not.toBeNull();
    const text = result!.content[0]!;
    expect(text.type).toBe("text");
    if (text.type === "text") {
      expect(text.text).toContain("Result offloaded");
      expect(text.text).toContain("100 items");
      expect(text.text).toContain(`Execution ID: ${EXEC_ID}`);
      expect(text.text).toContain("Item structure:");
      expect(text.text).toContain("id");
      expect(text.text).toContain("name");
      expect(text.text).toContain("_gateway.get_result");
      expect(text.text).toContain(EXEC_ID);
    }
  });

  it("should offload array of primitives exceeding threshold", () => {
    const large = Array.from({ length: 10000 }, (_, i) => i);
    const result = maybeOffloadResult(large, EXEC_ID, 100);

    expect(result).not.toBeNull();
    const text = result!.content[0]!;
    if (text.type === "text") {
      expect(text.text).toContain("Result offloaded");
      expect(text.text).toContain("10000 number items");
      expect(text.text).toContain("_gateway.get_result");
    }
  });

  it("should offload large object exceeding threshold", () => {
    const large: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      large[`key${i}`] = "x".repeat(1000);
    }
    const result = maybeOffloadResult(large, EXEC_ID, 100);

    expect(result).not.toBeNull();
    const text = result!.content[0]!;
    if (text.type === "text") {
      expect(text.text).toContain("Result offloaded");
      expect(text.text).toContain("object with 50 keys");
      expect(text.text).toContain("Structure:");
      expect(text.text).toContain("_gateway.get_result");
    }
  });

  it("should offload large string exceeding threshold", () => {
    const large = "x".repeat(100_000);
    const result = maybeOffloadResult(large, EXEC_ID, 100);

    expect(result).not.toBeNull();
    const text = result!.content[0]!;
    if (text.type === "text") {
      expect(text.text).toContain("Result offloaded");
      expect(text.text).toContain("100000 bytes, string");
      expect(text.text).toContain("_gateway.get_result");
      expect(text.text).toContain("string.sub");
    }
  });

  it("should handle primitive result types with fallback", () => {
    // Force offloading a number by using threshold of 1
    // In practice this is near-impossible, but the fallback should work
    const result = maybeOffloadResult(42, EXEC_ID, 1);

    expect(result).not.toBeNull();
    const text = result!.content[0]!;
    if (text.type === "text") {
      expect(text.text).toContain("Result offloaded");
      expect(text.text).toContain("number");
      expect(text.text).toContain("_gateway.get_result");
    }
  });

  it("should include contextual Lua snippet for array of objects", () => {
    const data = [{ id: 1, name: "test" }];
    // Use threshold of 1 to force offloading
    const result = maybeOffloadResult(data, EXEC_ID, 1);

    const text = result!.content[0]!;
    if (text.type === "text") {
      expect(text.text).toContain("math.min(10, #data)");
      expect(text.text).toContain("table.insert(subset, data[i])");
    }
  });

  it("should use bracket notation for object key access in Lua snippets", () => {
    const data = { "my-key": 1, "another.key": 2, normal: 3, extra: 4 };
    const result = maybeOffloadResult(data, EXEC_ID, 1);

    const text = result!.content[0]!;
    if (text.type === "text") {
      // Should use bracket notation: data["my-key"] not data.my-key
      expect(text.text).toContain('["my-key"] = data["my-key"]');
      expect(text.text).toContain('["another.key"] = data["another.key"]');
      expect(text.text).toContain('["normal"] = data["normal"]');
      // Only first 3 keys shown in the snippet
      expect(text.text).not.toContain('data["extra"]');
    }
  });
});
