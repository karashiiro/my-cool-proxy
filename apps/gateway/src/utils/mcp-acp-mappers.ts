import type {
  CreateMessageRequest,
  CreateMessageResult,
  SamplingContent,
  SamplingMessage,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ContentBlock,
  PromptCapabilities,
} from "@my-cool-proxy/acp-client";

type SamplingParams = CreateMessageRequest["params"];

/**
 * Map an MCP content block to an ACP ContentBlock.
 *
 * Text, image, and audio map 1:1 between MCP and ACP.
 * Other types (tool_use, tool_result) are serialized as text placeholders.
 */
function mapMcpBlockToAcp(
  block: Exclude<SamplingMessage["content"], unknown[]>,
): ContentBlock {
  if (block.type === "text") {
    return { type: "text", text: block.text } as ContentBlock;
  }

  if (block.type === "image") {
    return {
      type: "image",
      data: block.data,
      mimeType: block.mimeType,
    } as ContentBlock;
  }

  if (block.type === "audio") {
    return {
      type: "audio",
      data: block.data,
      mimeType: block.mimeType,
    } as ContentBlock;
  }

  // Fallback for unmappable types (tool_use, tool_result)
  return { type: "text", text: `[${block.type}]` } as ContentBlock;
}

/**
 * Normalize message content to an array of blocks.
 */
function normalizeContent(
  content: SamplingMessage["content"],
): Exclude<SamplingMessage["content"], unknown[]>[] {
  if (Array.isArray(content)) {
    return content;
  }
  return [content];
}

/**
 * Capitalize the first letter of a role string for display.
 */
function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Build the sampling parameters info block, if any non-default
 * parameters are present beyond the required maxTokens.
 */
function buildParametersBlock(params: SamplingParams): ContentBlock | null {
  const parts: string[] = [];

  if (params.temperature !== undefined) {
    parts.push(`temperature=${params.temperature}`);
  }

  if (params.maxTokens !== undefined) {
    parts.push(`maxTokens=${params.maxTokens}`);
  }

  if (params.stopSequences && params.stopSequences.length > 0) {
    parts.push(`stopSequences=${JSON.stringify(params.stopSequences)}`);
  }

  if (params.modelPreferences) {
    parts.push(`modelPreferences=${JSON.stringify(params.modelPreferences)}`);
  }

  // Only include the block when there's something beyond just maxTokens
  if (parts.length <= 1) {
    return null;
  }

  return {
    type: "text",
    text: `[Sampling parameters: ${parts.join(", ")}]`,
  } as ContentBlock;
}

/**
 * Map MCP CreateMessageRequest params to an array of ACP ContentBlock.
 *
 * Conversion rules:
 * - systemPrompt -> `[System]: {text}` text block
 * - Text-only messages -> `[Role]: {text}` (single text block, backward-compatible)
 * - Messages with non-text content -> role-labeled text blocks + native content blocks
 * - Image/audio content -> passed through natively when agent supports it (per promptCapabilities),
 *   otherwise serialized as text placeholders
 * - Sampling parameters (temperature, maxTokens, etc.) -> `[Sampling parameters: ...]` block
 * - includeContext -> not mappable, skipped
 *
 * @param params - MCP sampling request parameters
 * @param promptCapabilities - ACP agent's advertised prompt capabilities (from initialize handshake).
 *   When omitted, image and audio are NOT passed through natively (safe default).
 */
export function mapMcpToAcpPrompt(
  params: SamplingParams,
  promptCapabilities: PromptCapabilities = {},
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // System prompt as the first block
  if (params.systemPrompt) {
    blocks.push({
      type: "text",
      text: `[System]: ${params.systemPrompt}`,
    } as ContentBlock);
  }

  // Messages with role labels
  for (const message of params.messages) {
    const role = formatRole(message.role);
    const contentBlocks = normalizeContent(message.content);

    // Separate text and non-text blocks
    const textParts: string[] = [];
    const nonTextBlocks: ContentBlock[] = [];

    for (const block of contentBlocks) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "image" && promptCapabilities.image) {
        nonTextBlocks.push(mapMcpBlockToAcp(block));
      } else if (block.type === "audio" && promptCapabilities.audio) {
        nonTextBlocks.push(mapMcpBlockToAcp(block));
      } else if (block.type === "image" || block.type === "audio") {
        // Agent doesn't support this content type - fall back to placeholder
        textParts.push(`[${block.type}: ${block.mimeType}]`);
      } else {
        // tool_use, tool_result, etc. - serialize as text
        textParts.push(`[${block.type}]`);
      }
    }

    // If there's any text, emit it with the role label
    if (textParts.length > 0) {
      blocks.push({
        type: "text",
        text: `[${role}]: ${textParts.join(" ")}`,
      } as ContentBlock);
    } else if (nonTextBlocks.length > 0) {
      // No text, but has non-text content: emit role label separately
      blocks.push({
        type: "text",
        text: `[${role}]:`,
      } as ContentBlock);
    }

    // Append non-text blocks after the role-labeled text
    blocks.push(...nonTextBlocks);
  }

  // Sampling parameters info block (if interesting params present)
  const paramsBlock = buildParametersBlock(params);
  if (paramsBlock) {
    blocks.push(paramsBlock);
  }

  return blocks;
}

/**
 * Map from ACP stop reason strings to MCP stop reason strings.
 */
const STOP_REASON_MAP: Record<string, string> = {
  end_turn: "endTurn",
  max_tokens: "maxTokens",
  stop_sequence: "stopSequence",
};

/**
 * Map an ACP ContentBlock to an MCP content block for CreateMessageResult.
 *
 * Text, image, and audio map 1:1 between ACP and MCP.
 * ACP resource types are serialized as text since MCP sampling has no resource type.
 */
function mapAcpBlockToMcp(block: ContentBlock): SamplingContent {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }

  if (block.type === "image") {
    return { type: "image", data: block.data, mimeType: block.mimeType };
  }

  if (block.type === "audio") {
    return { type: "audio", data: block.data, mimeType: block.mimeType };
  }

  if (block.type === "resource_link") {
    return { type: "text", text: `[Resource: ${block.name} (${block.uri})]` };
  }

  // type === "resource" (embedded resource)
  const res = block.resource;
  if ("text" in res) {
    return { type: "text", text: res.text };
  }
  return { type: "text", text: `[Embedded resource: ${res.uri}]` };
}

/**
 * Map ACP prompt result (content blocks + stop reason) to an MCP CreateMessageResult.
 *
 * CreateMessageResult only supports a single content block, so multiple ACP
 * response blocks are merged:
 * - Text blocks are concatenated into one TextContent
 * - Non-text blocks (image/audio) take priority as the primary response
 * - When both text and non-text are present, the first non-text block wins
 *   (it's the primary content; text is usually just a preamble)
 * - ACP resource types are serialized as text
 * - Model is always "acp-agent", role is always "assistant"
 */
export function mapAcpToMcpResult(
  content: ContentBlock[],
  stopReason: string,
): CreateMessageResult {
  const textParts: string[] = [];
  let firstNonTextBlock: SamplingContent | null = null;

  for (const block of content) {
    const mcpBlock = mapAcpBlockToMcp(block);
    if (mcpBlock.type === "text") {
      textParts.push(mcpBlock.text);
    } else if (!firstNonTextBlock) {
      firstNonTextBlock = mcpBlock;
    }
  }

  // Prefer non-text content (image/audio) when present, since the
  // non-text block is typically the primary response content.
  const resultContent: SamplingContent = firstNonTextBlock ?? {
    type: "text",
    text: textParts.join(""),
  };

  return {
    role: "assistant",
    content: resultContent,
    model: "acp-agent",
    stopReason: STOP_REASON_MAP[stopReason] ?? "endTurn",
  };
}
