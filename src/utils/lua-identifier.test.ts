import { describe, it, expect } from "vitest";
import { sanitizeLuaIdentifier } from "./lua-identifier.js";

describe("sanitizeLuaIdentifier", () => {
  it("should keep valid identifiers unchanged", () => {
    expect(sanitizeLuaIdentifier("valid_name")).toBe("valid_name");
    expect(sanitizeLuaIdentifier("camelCase")).toBe("camelCase");
    expect(sanitizeLuaIdentifier("with_underscore")).toBe("with_underscore");
    expect(sanitizeLuaIdentifier("_leading")).toBe("_leading");
  });

  it("should replace hyphens with underscores", () => {
    expect(sanitizeLuaIdentifier("mcp-docs")).toBe("mcp_docs");
    expect(sanitizeLuaIdentifier("my-cool-server")).toBe("my_cool_server");
  });

  it("should replace dots with underscores", () => {
    expect(sanitizeLuaIdentifier("my.server")).toBe("my_server");
    expect(sanitizeLuaIdentifier("domain.name.here")).toBe("domain_name_here");
  });

  it("should replace all invalid characters with underscores", () => {
    expect(sanitizeLuaIdentifier("test@name")).toBe("test_name");
    expect(sanitizeLuaIdentifier("server#1")).toBe("server_1");
    expect(sanitizeLuaIdentifier("with spaces")).toBe("with_spaces");
    expect(sanitizeLuaIdentifier("special!@#$chars")).toBe("special____chars");
  });

  it("should prefix with underscore if starts with number", () => {
    expect(sanitizeLuaIdentifier("123server")).toBe("_123server");
    expect(sanitizeLuaIdentifier("1-test")).toBe("_1_test");
  });

  it("should prefix Lua keywords with underscore", () => {
    expect(sanitizeLuaIdentifier("end")).toBe("_end");
    expect(sanitizeLuaIdentifier("if")).toBe("_if");
    expect(sanitizeLuaIdentifier("function")).toBe("_function");
    expect(sanitizeLuaIdentifier("local")).toBe("_local");
    expect(sanitizeLuaIdentifier("return")).toBe("_return");
    expect(sanitizeLuaIdentifier("while")).toBe("_while");
    expect(sanitizeLuaIdentifier("for")).toBe("_for");
    expect(sanitizeLuaIdentifier("do")).toBe("_do");
    expect(sanitizeLuaIdentifier("true")).toBe("_true");
    expect(sanitizeLuaIdentifier("false")).toBe("_false");
    expect(sanitizeLuaIdentifier("nil")).toBe("_nil");
  });

  it("should handle empty string", () => {
    expect(sanitizeLuaIdentifier("")).toBe("_unnamed");
  });

  it("should handle string with only underscores", () => {
    expect(sanitizeLuaIdentifier("_")).toBe("_unnamed");
  });

  it("should handle complex real-world cases", () => {
    expect(sanitizeLuaIdentifier("@anthropic/sdk")).toBe("_anthropic_sdk");
    expect(sanitizeLuaIdentifier("some-server.v2")).toBe("some_server_v2");
    expect(sanitizeLuaIdentifier("api-gateway-v1.2.3")).toBe(
      "api_gateway_v1_2_3",
    );
  });

  it("should handle multiple transformations at once", () => {
    // starts with number + has hyphen + is keyword
    expect(sanitizeLuaIdentifier("1-end")).toBe("_1_end");
  });
});
