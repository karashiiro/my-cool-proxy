import {
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
} from "shiki";
import type { LuaToolCall } from "./types.js";

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

/**
 * Get or create a cached Shiki highlighter instance.
 */
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark" satisfies BundledTheme],
      langs: ["lua" satisfies BundledLanguage],
    });
  }
  return highlighterPromise;
}

/**
 * Pre-warm the Shiki highlighter so the first highlight call doesn't block.
 * Call this eagerly on page load to avoid a UI freeze on first execution click.
 */
export function preloadHighlighter(): void {
  getHighlighter();
}

/**
 * Lua reserved keywords — identifiers matching these get prefixed with `_`.
 * Mirrors the gateway's `sanitizeLuaIdentifier` from mcp-utilities.
 */
const LUA_KEYWORDS = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
]);

/**
 * Convert a name to its Lua identifier form.
 * Mirrors the gateway's `sanitizeLuaIdentifier` from mcp-utilities.
 *
 * Tool call records store the original MCP server/tool names (e.g. "stderr-server"),
 * but the Lua source uses sanitized identifiers (e.g. "stderr_server").
 */
function toLuaIdentifier(name: string): string {
  let id = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(id)) id = `_${id}`;
  if (LUA_KEYWORDS.has(id)) id = `_${id}`;
  if (id === "" || id === "_") id = "_unnamed";
  return id;
}

/** A source range marking where a tool call pattern appears. */
interface ToolCallRange {
  start: number;
  end: number;
  tc: LuaToolCall;
}

/**
 * Find non-overlapping tool call ranges in the source code.
 * Each range marks where `luaServerName.luaToolName` appears.
 * Server/tool names are sanitized to Lua identifiers before matching.
 */
function findToolCallRanges(
  code: string,
  toolCalls: LuaToolCall[],
): ToolCallRange[] {
  const ranges: ToolCallRange[] = [];
  const claimed = new Set<number>();

  // Match each tool call to the next unclaimed occurrence of its pattern in source order.
  // The API returns tool calls in descending (newest-first) order, so reverse to get
  // chronological order: the first call record binds to the first source occurrence, etc.
  const chronological = [...toolCalls].reverse();
  for (const tc of chronological) {
    const luaServer = toLuaIdentifier(tc.serverName);
    const luaTool = toLuaIdentifier(tc.toolName);
    const pattern = `${luaServer}.${luaTool}`;
    let searchFrom = 0;
    while (searchFrom < code.length) {
      const idx = code.indexOf(pattern, searchFrom);
      if (idx === -1) break;
      if (!claimed.has(idx)) {
        claimed.add(idx);
        ranges.push({ start: idx, end: idx + pattern.length, tc });
        break;
      }
      searchFrom = idx + 1;
    }
  }

  return ranges.sort((a, b) => a.start - b.start);
}

/**
 * Escape a string for safe inclusion in HTML content and attributes.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Validate a CSS color value (hex, named, or oklch/hsl/rgb function). */
const SAFE_COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^(?:oklch|hsl|rgb)a?\([^)]+\)$/;

function sanitizeColor(color: string, fallback: string): string {
  return SAFE_COLOR_RE.test(color) ? color : fallback;
}

/**
 * Render a token (or partial token) as a colored span.
 */
function renderSpan(text: string, color: string): string {
  if (text.length === 0) return "";
  return `<span style="color:${sanitizeColor(color, "#E1E4E8")}">${escapeHtml(text)}</span>`;
}

/**
 * Open a button element for a tool call range.
 * callId and label are escaped to prevent XSS via injected attribute values.
 */
function openButton(tc: LuaToolCall): string {
  const label = `${toLuaIdentifier(tc.serverName)}.${toLuaIdentifier(tc.toolName)}`;
  return `<button class="tool-call-btn" data-call-id="${escapeHtml(tc.callId)}" role="button" aria-label="${escapeHtml(label)}">`;
}

/**
 * Highlight Lua code and inject clickable tool call buttons.
 *
 * Uses Shiki's `codeToTokens()` API to get individual tokens with their
 * positions and colors, then builds the HTML manually. Tool call patterns
 * are wrapped in `<button>` elements with proper nesting — buttons never
 * cross span boundaries because we control span creation.
 *
 * Server/tool names from the database (original MCP names like "stderr-server")
 * are converted to their Lua identifier form ("stderr_server") before matching
 * against the source code.
 */
export async function highlightLua(
  code: string,
  toolCalls: LuaToolCall[],
): Promise<string> {
  const highlighter = await getHighlighter();
  const { tokens, bg } = highlighter.codeToTokens(code, {
    lang: "lua",
    theme: "github-dark",
  });

  const ranges =
    toolCalls.length > 0 ? findToolCallRanges(code, toolCalls) : [];

  // Flatten all tokens across lines, inserting synthetic newline tokens
  // at line boundaries. codeToTokens() returns tokens grouped by line but
  // doesn't include the \n characters themselves.
  const allTokens: {
    content: string;
    offset: number;
    color: string;
    isNewline?: boolean;
  }[] = [];
  for (let lineIdx = 0; lineIdx < tokens.length; lineIdx++) {
    const line = tokens[lineIdx]!;
    for (const token of line) {
      allTokens.push({
        content: token.content,
        offset: token.offset,
        color: token.color ?? "#E1E4E8",
      });
    }
    // Add a synthetic newline token between lines (not after the last line)
    if (lineIdx < tokens.length - 1) {
      // Calculate the offset of the newline: it's right after the last token on this line
      const lastToken = line[line.length - 1];
      const nlOffset = lastToken
        ? lastToken.offset + lastToken.content.length
        : 0;
      allTokens.push({
        content: "\n",
        offset: nlOffset,
        color: "#E1E4E8",
        isNewline: true,
      });
    }
  }

  // Build HTML by walking through tokens and inserting button wrappers
  let html = "";
  let rangeIdx = 0;
  let insideButton = false;

  for (const token of allTokens) {
    // Synthetic newline tokens are rendered as a sentinel marker for wrapLines
    if (token.isNewline) {
      html += NEWLINE_SENTINEL;
      continue;
    }

    const tokenStart = token.offset;
    const tokenEnd = token.offset + token.content.length;
    let cursor = tokenStart;

    // Process this token, potentially splitting it at range boundaries
    while (cursor < tokenEnd) {
      const currentRange = ranges[rangeIdx];

      if (!currentRange || cursor >= currentRange.end) {
        // No active range, or we've passed it
        if (insideButton) {
          html += "</button>";
          insideButton = false;
          rangeIdx++;
          continue; // Re-check with next range
        }

        // Check if a new range starts within this token
        const nextRange = ranges[rangeIdx];
        if (
          nextRange &&
          nextRange.start >= cursor &&
          nextRange.start < tokenEnd
        ) {
          // Emit text before the range start
          if (nextRange.start > cursor) {
            html += renderSpan(
              token.content.slice(
                cursor - tokenStart,
                nextRange.start - tokenStart,
              ),
              token.color,
            );
            cursor = nextRange.start;
          }
          // Open button
          html += openButton(nextRange.tc);
          insideButton = true;

          // Emit text from range start to min(tokenEnd, rangeEnd)
          const sliceEnd = Math.min(tokenEnd, nextRange.end);
          html += renderSpan(
            token.content.slice(cursor - tokenStart, sliceEnd - tokenStart),
            token.color,
          );
          cursor = sliceEnd;

          if (cursor >= nextRange.end) {
            html += "</button>";
            insideButton = false;
            rangeIdx++;
          }
        } else {
          // No range involvement, emit the rest of this token
          html += renderSpan(
            token.content.slice(cursor - tokenStart),
            token.color,
          );
          cursor = tokenEnd;
        }
      } else if (insideButton) {
        // We're inside a button, emit until range end or token end
        const sliceEnd = Math.min(tokenEnd, currentRange.end);
        html += renderSpan(
          token.content.slice(cursor - tokenStart, sliceEnd - tokenStart),
          token.color,
        );
        cursor = sliceEnd;

        if (cursor >= currentRange.end) {
          html += "</button>";
          insideButton = false;
          rangeIdx++;
        }
      } else {
        // Range hasn't started yet - emit text before it
        if (currentRange.start >= cursor && currentRange.start < tokenEnd) {
          if (currentRange.start > cursor) {
            html += renderSpan(
              token.content.slice(
                cursor - tokenStart,
                currentRange.start - tokenStart,
              ),
              token.color,
            );
            cursor = currentRange.start;
          }
          html += openButton(currentRange.tc);
          insideButton = true;

          const sliceEnd = Math.min(tokenEnd, currentRange.end);
          html += renderSpan(
            token.content.slice(cursor - tokenStart, sliceEnd - tokenStart),
            token.color,
          );
          cursor = sliceEnd;

          if (cursor >= currentRange.end) {
            html += "</button>";
            insideButton = false;
            rangeIdx++;
          }
        } else {
          html += renderSpan(
            token.content.slice(cursor - tokenStart),
            token.color,
          );
          cursor = tokenEnd;
        }
      }
    }
  }

  // Close any unclosed button
  if (insideButton) {
    html += "</button>";
  }

  // Wrap in the same structure Shiki uses, with line spans
  return `<pre class="shiki github-dark" style="background-color:${sanitizeColor(bg, "#24292e")};color:#e1e4e8" tabindex="0"><code>${wrapLines(html)}</code></pre>`;
}

/** Sentinel marker used to identify synthetic newline tokens in the HTML output. */
const NEWLINE_SENTINEL = "\u200B\n\u200B";

/**
 * Wrap the generated HTML in per-line `<span class="line">` elements.
 * Splits on the sentinel marker rather than a specific color value.
 */
function wrapLines(tokenHtml: string): string {
  const parts = tokenHtml.split(NEWLINE_SENTINEL);
  return parts.map((part) => `<span class="line">${part}</span>`).join("\n");
}
