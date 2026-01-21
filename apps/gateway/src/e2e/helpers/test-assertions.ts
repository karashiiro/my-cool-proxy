import type {
  CallToolResult,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { expect } from "vitest";

/**
 * Type alias for CallToolResult with content property
 * Extracts the variant of CallToolResult that has the content field
 */
export type CallToolResultWithContent = Extract<
  CallToolResult,
  { content: unknown }
>;

/**
 * Union type for all content types - extracted directly from the SDK
 */
export type Content = CallToolResultWithContent["content"][number];

/**
 * Type guard to check if CallToolResult has content property
 */
export function hasContent(
  result: CallToolResult,
): result is CallToolResultWithContent {
  return "content" in result && result.content !== undefined;
}

/**
 * Asserts that a CallToolResult has content and narrows its type.
 * Use this at the start of tests to narrow the type for subsequent assertions.
 */
export function assertHasContent(
  result: CallToolResult,
): asserts result is CallToolResultWithContent {
  expect(hasContent(result)).toBe(true);
  if (!hasContent(result)) {
    throw new Error("Result does not have content property");
  }
}

/**
 * Helper function that wraps a CallToolResult and returns it as CallToolResultWithContent.
 * Use this to narrow the type when passing results to assertion functions.
 */
export function assumeContent(
  result: CallToolResult,
): CallToolResultWithContent {
  assertHasContent(result);
  return result;
}

/**
 * Type guard to check if content is TextContent
 */
export function isTextContent(content: Content): content is TextContent {
  return content.type === "text";
}

/**
 * Extracts the first content item from a CallToolResult.
 * Throws if result has no content.
 */
export function getFirstContent(result: CallToolResultWithContent): Content {
  expect(result.content).toHaveLength(1);
  const content = result.content[0];
  expect(content).toBeDefined();
  return content!;
}

/**
 * Extracts the first content item and asserts it's text content.
 * Returns the text content for further assertions.
 * This version accepts unknown result and does narrowing automatically.
 */
export function getTextContent(result: unknown): TextContent {
  assertHasContent(result as CallToolResult);
  const content = getFirstContent(result as CallToolResultWithContent);
  expect(content.type).toBe("text");
  return content as TextContent;
}

/**
 * Gets the text string from a result, asserting it's text content.
 * This version accepts unknown result and does narrowing automatically.
 */
export function getTextString(result: unknown): string {
  const content = getTextContent(result);
  return content.text;
}

/**
 * Asserts that a result contains text matching the given string or regex.
 */
export function assertTextContains(
  result: unknown,
  matcher: string | RegExp,
): void {
  assertHasContent(result as CallToolResult);
  const text = getTextString(result);
  if (typeof matcher === "string") {
    expect(text).toContain(matcher);
  } else {
    expect(text).toMatch(matcher);
  }
}

/**
 * Asserts that a result is an error with optional message check.
 */
export function assertIsError(result: unknown, messageContains?: string): void {
  const r = result as CallToolResult;
  expect(r.isError).toBe(true);
  if (messageContains && hasContent(r)) {
    assertTextContains(result, messageContains);
  }
}

/**
 * Asserts that a result is successful (not an error).
 */
export function assertIsSuccess(result: unknown): void {
  const r = result as CallToolResult;
  expect(r.isError).not.toBe(true);
  expect(hasContent(r)).toBe(true);
}

/**
 * Asserts that multiple results all succeeded.
 */
export function assertAllSucceeded(results: unknown[]): void {
  results.forEach((result) => assertIsSuccess(result));
}

/**
 * Asserts that text content matches all provided patterns.
 */
export function assertTextContainsAll(
  result: unknown,
  patterns: Array<string | RegExp>,
): void {
  assertHasContent(result as CallToolResult);
  const text = getTextString(result);
  patterns.forEach((pattern) => {
    if (typeof pattern === "string") {
      expect(text).toContain(pattern);
    } else {
      expect(text).toMatch(pattern);
    }
  });
}
