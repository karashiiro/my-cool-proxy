import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { inferSchema, formatSchema } from "@my-cool-proxy/mcp-utilities";

/**
 * Check if a result should be offloaded based on its serialized size.
 * Returns a CallToolResult with schema summary if offloaded, or null to proceed normally.
 */
export function maybeOffloadResult(
  result: unknown,
  executionId: string,
  threshold: number,
): CallToolResult | null {
  if (result === undefined || result === null) return null;
  if (threshold <= 0) return null;

  const resultJson =
    typeof result === "string" ? result : JSON.stringify(result);
  if (resultJson.length <= threshold) return null;

  return buildOffloadedResponse(result, resultJson.length, executionId);
}

/**
 * Build a human-readable offloaded response with schema summary and retrieval instructions.
 */
function buildOffloadedResponse(
  result: unknown,
  byteLength: number,
  executionId: string,
): CallToolResult {
  const lines: string[] = [];

  if (Array.isArray(result)) {
    const count = result.length;
    if (count > 0 && typeof result[0] === "object" && result[0] !== null) {
      // Array of objects
      lines.push(`Result offloaded (${byteLength} bytes, ${count} items).`);
      lines.push("");
      lines.push(`Execution ID: ${executionId}`);
      lines.push("");
      lines.push("Item structure:");
      const schema = inferSchema(result[0]);
      const formatted = formatSchema(schema);
      lines.push(...formatted);
      lines.push("");
      lines.push("Retrieve and filter in a follow-up script:");
      lines.push("");
      lines.push(
        `  local data = _gateway.get_result({ id = "${executionId}" }):await()`,
      );
      lines.push("  -- Example: get first 10 items");
      lines.push("  local subset = {}");
      lines.push("  for i = 1, math.min(10, #data) do");
      lines.push("    table.insert(subset, data[i])");
      lines.push("  end");
      lines.push("  result(subset)");
    } else {
      // Array of primitives
      const itemType = count > 0 ? typeof result[0] : "unknown";
      lines.push(
        `Result offloaded (${byteLength} bytes, ${count} ${itemType} items).`,
      );
      lines.push("");
      lines.push(`Execution ID: ${executionId}`);
      lines.push("");
      lines.push("Retrieve and filter in a follow-up script:");
      lines.push("");
      lines.push(
        `  local data = _gateway.get_result({ id = "${executionId}" }):await()`,
      );
      lines.push("  -- Example: slice first 10 elements");
      lines.push("  local subset = {}");
      lines.push("  for i = 1, math.min(10, #data) do");
      lines.push("    table.insert(subset, data[i])");
      lines.push("  end");
      lines.push("  result(subset)");
    }
  } else if (typeof result === "object" && result !== null) {
    // Object with many keys
    const keys = Object.keys(result as Record<string, unknown>);
    lines.push(
      `Result offloaded (${byteLength} bytes, object with ${keys.length} keys).`,
    );
    lines.push("");
    lines.push(`Execution ID: ${executionId}`);
    lines.push("");
    lines.push("Structure:");
    const schema = inferSchema(result);
    const formatted = formatSchema(schema);
    lines.push(...formatted);
    lines.push("");
    lines.push("Retrieve and filter in a follow-up script:");
    lines.push("");
    lines.push(
      `  local data = _gateway.get_result({ id = "${executionId}" }):await()`,
    );
    lines.push("  -- Access specific fields");
    lines.push(
      `  result({ ${keys
        .slice(0, 3)
        .map((k) => `["${k}"] = data["${k}"]`)
        .join(", ")} })`,
    );
  } else if (typeof result === "string") {
    // Large string
    lines.push(`Result offloaded (${byteLength} bytes, string).`);
    lines.push("");
    lines.push(`Execution ID: ${executionId}`);
    lines.push("");
    lines.push("Retrieve and filter in a follow-up script:");
    lines.push("");
    lines.push(
      `  local data = _gateway.get_result({ id = "${executionId}" }):await()`,
    );
    lines.push("  -- Example: get first 1000 characters");
    lines.push("  result(string.sub(data, 1, 1000))");
  } else {
    // Fallback for primitives (number, boolean) — unlikely to exceed threshold
    lines.push(`Result offloaded (${byteLength} bytes, ${typeof result}).`);
    lines.push("");
    lines.push(`Execution ID: ${executionId}`);
    lines.push("");
    lines.push("Retrieve in a follow-up script:");
    lines.push("");
    lines.push(
      `  local data = _gateway.get_result({ id = "${executionId}" }):await()`,
    );
    lines.push("  result(data)");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
