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
function appendRetrievalHeader(
  lines: string[],
  header: string,
  executionId: string,
): void {
  lines.push(header);
  lines.push("");
  lines.push(`Execution ID: ${executionId}`);
}

function appendArraySliceExample(lines: string[], executionId: string): void {
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
}

function buildArrayResponse(
  lines: string[],
  result: unknown[],
  byteLength: number,
  executionId: string,
): void {
  const count = result.length;
  if (count > 0 && typeof result[0] === "object" && result[0] !== null) {
    appendRetrievalHeader(
      lines,
      `Result offloaded (${byteLength} bytes, ${count} items).`,
      executionId,
    );
    lines.push("");
    lines.push("Item structure:");
    const schema = inferSchema(result[0]);
    lines.push(...formatSchema(schema));
    appendArraySliceExample(lines, executionId);
  } else {
    const itemType = count > 0 ? typeof result[0] : "unknown";
    appendRetrievalHeader(
      lines,
      `Result offloaded (${byteLength} bytes, ${count} ${itemType} items).`,
      executionId,
    );
    appendArraySliceExample(lines, executionId);
  }
}

function buildObjectResponse(
  lines: string[],
  result: Record<string, unknown>,
  byteLength: number,
  executionId: string,
): void {
  const keys = Object.keys(result);
  appendRetrievalHeader(
    lines,
    `Result offloaded (${byteLength} bytes, object with ${keys.length} keys).`,
    executionId,
  );
  lines.push("");
  lines.push("Structure:");
  lines.push(...formatSchema(inferSchema(result)));
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
}

function buildOffloadedResponse(
  result: unknown,
  byteLength: number,
  executionId: string,
): CallToolResult {
  const lines: string[] = [];

  if (Array.isArray(result)) {
    buildArrayResponse(lines, result, byteLength, executionId);
  } else if (typeof result === "object" && result !== null) {
    buildObjectResponse(
      lines,
      result as Record<string, unknown>,
      byteLength,
      executionId,
    );
  } else if (typeof result === "string") {
    appendRetrievalHeader(
      lines,
      `Result offloaded (${byteLength} bytes, string).`,
      executionId,
    );
    lines.push("");
    lines.push("Retrieve and filter in a follow-up script:");
    lines.push("");
    lines.push(
      `  local data = _gateway.get_result({ id = "${executionId}" }):await()`,
    );
    lines.push("  -- Example: get first 1000 characters");
    lines.push("  result(string.sub(data, 1, 1000))");
  } else {
    appendRetrievalHeader(
      lines,
      `Result offloaded (${byteLength} bytes, ${typeof result}).`,
      executionId,
    );
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
