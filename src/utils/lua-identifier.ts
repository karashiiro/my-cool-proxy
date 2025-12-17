/**
 * Lua reserved keywords that cannot be used as identifiers
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
 * Sanitizes a string to be a valid Lua identifier.
 *
 * Lua identifiers must:
 * - Start with a letter (a-z, A-Z) or underscore (_)
 * - Contain only letters, digits (0-9), and underscores
 * - Not be a reserved keyword
 *
 * @param name - The original name to sanitize
 * @returns A valid Lua identifier
 *
 * @example
 * sanitizeLuaIdentifier("mcp-docs") // "mcp_docs"
 * sanitizeLuaIdentifier("my.server") // "my_server"
 * sanitizeLuaIdentifier("123server") // "_123server"
 * sanitizeLuaIdentifier("end") // "_end"
 */
export function sanitizeLuaIdentifier(name: string): string {
  // Replace invalid characters with underscores
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");

  // If starts with a number, prefix with underscore
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  // If it's a Lua keyword, prefix with underscore
  if (LUA_KEYWORDS.has(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  // If somehow we end up with an empty string, use a default
  if (sanitized === "" || sanitized === "_") {
    sanitized = "_unnamed";
  }

  return sanitized;
}
