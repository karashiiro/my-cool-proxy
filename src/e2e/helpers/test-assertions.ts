import type {
  CallToolResult,
  TextContent,
  ImageContent,
  EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";
import { expect } from "vitest";

/**
 * Type guard to check if content is TextContent
 */
export function isTextContent(
  content: TextContent | ImageContent | EmbeddedResource,
): content is TextContent {
  return content.type === "text";
}

/**
 * Extracts the first content item from a CallToolResult.
 * Throws if result has no content.
 */
export function getFirstContent(
  result: CallToolResult,
): TextContent | ImageContent | EmbeddedResource {
  expect(result.content).toHaveLength(1);
  const content = (
    result.content as Array<TextContent | ImageContent | EmbeddedResource>
  )[0];
  expect(content).toBeDefined();
  return content!;
}

/**
 * Extracts the first content item and asserts it's text content.
 * Returns the text content for further assertions.
 */
export function getTextContent(result: CallToolResult): TextContent {
  const content = getFirstContent(result);
  expect(content.type).toBe("text");
  return content as TextContent;
}

/**
 * Gets the text string from a CallToolResult, asserting it's text content.
 */
export function getTextString(result: CallToolResult): string {
  const content = getTextContent(result);
  return content.text;
}

/**
 * Asserts that a result contains text matching the given string or regex.
 */
export function assertTextContains(
  result: CallToolResult,
  matcher: string | RegExp,
): void {
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
export function assertIsError(
  result: CallToolResult,
  messageContains?: string,
): void {
  expect(result.isError).toBe(true);
  if (messageContains) {
    assertTextContains(result, messageContains);
  }
}

/**
 * Asserts that a result is successful (not an error).
 */
export function assertIsSuccess(result: CallToolResult): void {
  expect(result.isError).not.toBe(true);
  expect(result.content).toBeDefined();
}

/**
 * Asserts that multiple results all succeeded.
 */
export function assertAllSucceeded(results: CallToolResult[]): void {
  results.forEach((result) => assertIsSuccess(result));
}

/**
 * Asserts that text content matches all provided patterns.
 */
export function assertTextContainsAll(
  result: CallToolResult,
  patterns: Array<string | RegExp>,
): void {
  const text = getTextString(result);
  patterns.forEach((pattern) => {
    if (typeof pattern === "string") {
      expect(text).toContain(pattern);
    } else {
      expect(text).toMatch(pattern);
    }
  });
}
