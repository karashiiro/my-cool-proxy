import { describe, it, expect } from "vitest";
import {
  namespaceResourceUri,
  parseResourceUri,
  namespaceResource,
  namespaceCallToolResultResources,
  namespaceGetPromptResultResources,
  SKILL_URI_SCHEME,
  createSkillResourceUri,
  parseSkillResourceUri,
  isSkillResourceUri,
} from "./resource-uri.js";
import type {
  CallToolResult,
  GetPromptResult,
  Resource,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";

describe("resource-uri utils", () => {
  describe("namespaceResourceUri", () => {
    it("should namespace a resource URI with server name", () => {
      const result = namespaceResourceUri("context7", "file:///docs/README.md");

      expect(result).toBe("gw://context7/file:///docs/README.md");
    });

    it("should handle URIs with special characters", () => {
      const result = namespaceResourceUri(
        "my-server",
        "file:///path/to/file with spaces.txt",
      );

      expect(result).toBe(
        "gw://my-server/file:///path/to/file with spaces.txt",
      );
    });

    it("should handle URIs with query parameters", () => {
      const result = namespaceResourceUri(
        "api-server",
        "https://api.example.com/data?id=123&format=json",
      );

      expect(result).toBe(
        "gw://api-server/https://api.example.com/data?id=123&format=json",
      );
    });

    it("should handle URIs with fragments", () => {
      const result = namespaceResourceUri(
        "docs-server",
        "file:///docs/index.html#section",
      );

      expect(result).toBe("gw://docs-server/file:///docs/index.html#section");
    });

    it("should handle empty URIs", () => {
      const result = namespaceResourceUri("test-server", "");

      expect(result).toBe("gw://test-server/");
    });

    it("should handle server names with special characters", () => {
      const result = namespaceResourceUri("my-cool-server", "file:///test.txt");

      expect(result).toBe("gw://my-cool-server/file:///test.txt");
    });
  });

  describe("parseResourceUri", () => {
    it("should parse a valid namespaced URI", () => {
      const result = parseResourceUri("gw://context7/file:///docs/README.md");

      expect(result).toEqual({
        serverName: "context7",
        originalUri: "file:///docs/README.md",
      });
    });

    it("should parse URIs with complex paths", () => {
      const result = parseResourceUri(
        "gw://api-server/https://api.example.com/v1/data/items?id=123",
      );

      expect(result).toEqual({
        serverName: "api-server",
        originalUri: "https://api.example.com/v1/data/items?id=123",
      });
    });

    it("should handle server names with hyphens", () => {
      const result = parseResourceUri("gw://my-server/file:///test.txt");

      expect(result).toEqual({
        serverName: "my-server",
        originalUri: "file:///test.txt",
      });
    });

    it("should handle server names with underscores", () => {
      const result = parseResourceUri("gw://my_server/file:///test.txt");

      expect(result).toEqual({
        serverName: "my_server",
        originalUri: "file:///test.txt",
      });
    });

    it("should return null for URIs without mcp:// prefix", () => {
      const result = parseResourceUri("file:///docs/README.md");

      expect(result).toBeNull();
    });

    it("should return null for URIs missing server name", () => {
      const result = parseResourceUri("gw:///file:///test.txt");

      expect(result).toBeNull();
    });

    it("should return null for URIs missing original URI", () => {
      const result = parseResourceUri("gw://server-name");

      expect(result).toBeNull();
    });

    it("should return null for URIs with empty server name", () => {
      const result = parseResourceUri("gw:///original-uri");

      expect(result).toBeNull();
    });

    it("should return null for URIs with empty original URI", () => {
      const result = parseResourceUri("gw://server-name/");

      expect(result).toBeNull();
    });

    it("should return null for malformed URIs", () => {
      const result = parseResourceUri("not-a-valid-uri");

      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      const result = parseResourceUri("");

      expect(result).toBeNull();
    });

    it("should handle URIs with multiple slashes after server name", () => {
      const result = parseResourceUri("gw://server-name///file:///test.txt");

      expect(result).toEqual({
        serverName: "server-name",
        originalUri: "//file:///test.txt",
      });
    });

    it("should preserve URIs that start with a slash", () => {
      const result = parseResourceUri("gw://server-name//path/to/file.txt");

      expect(result).toEqual({
        serverName: "server-name",
        originalUri: "/path/to/file.txt",
      });
    });
  });

  describe("namespaceResource", () => {
    it("should namespace a resource object", () => {
      const resource: Resource = {
        uri: "file:///docs/README.md",
        name: "README",
        description: "Main documentation file",
        mimeType: "text/markdown",
      };

      const result = namespaceResource("docs-server", resource);

      expect(result).toEqual({
        uri: "gw://docs-server/file:///docs/README.md",
        name: "README",
        description: "Main documentation file",
        mimeType: "text/markdown",
      });
    });

    it("should preserve all resource properties", () => {
      const resource: Resource = {
        uri: "file:///data.json",
        name: "Data",
        mimeType: "application/json",
      };

      const result = namespaceResource("api", resource);

      expect(result.name).toBe("Data");
      expect(result.mimeType).toBe("application/json");
      expect(result.uri).toBe("gw://api/file:///data.json");
    });

    it("should not mutate the original resource object", () => {
      const resource: Resource = {
        uri: "file:///test.txt",
        name: "Test",
      };

      const originalUri = resource.uri;
      namespaceResource("server", resource);

      expect(resource.uri).toBe(originalUri);
    });
  });

  describe("namespaceCallToolResultResources", () => {
    it("should namespace resource_link content blocks", () => {
      const result: CallToolResult = {
        content: [
          { type: "text", text: "Here's a resource:" },
          {
            type: "resource_link",
            uri: "file:///data.json",
            name: "",
          },
        ],
      };

      const namespaced = namespaceCallToolResultResources(
        "data-server",
        result,
      );

      expect(namespaced.content).toHaveLength(2);
      expect(
        (namespaced.content[1] as { type: string; uri: string; name: string })
          .uri,
      ).toBe("gw://data-server/file:///data.json");
    });

    it("should namespace embedded resource content blocks", () => {
      const result: CallToolResult = {
        content: [
          {
            type: "resource",
            resource: {
              uri: "file:///document.txt",
              text: "Content here",
            },
          },
        ],
      };

      const namespaced = namespaceCallToolResultResources("docs", result);

      expect(namespaced.content[0]).toEqual({
        type: "resource",
        resource: {
          uri: "gw://docs/file:///document.txt",
          text: "Content here",
        },
      });
    });

    it("should handle mixed content types", () => {
      const result: CallToolResult = {
        content: [
          { type: "text", text: "Some text" },
          {
            type: "resource_link",
            uri: "file:///data.json",
            name: "",
          },
          {
            type: "resource",
            resource: {
              uri: "file:///doc.txt",
              text: "Doc content",
            },
          },
          { type: "text", text: "More text" },
        ],
      };

      const namespaced = namespaceCallToolResultResources("server", result);

      expect(namespaced.content[0]).toEqual({
        type: "text",
        text: "Some text",
      });
      expect((namespaced.content[1] as { uri: string }).uri).toBe(
        "gw://server/file:///data.json",
      );
      expect(
        (namespaced.content[2] as { resource: { uri: string } }).resource.uri,
      ).toBe("gw://server/file:///doc.txt");
      expect(namespaced.content[3]).toEqual({
        type: "text",
        text: "More text",
      });
    });

    it("should handle multiple resource_link blocks", () => {
      const result: CallToolResult = {
        content: [
          { type: "resource_link", uri: "file:///file1.txt", name: "" },
          { type: "resource_link", uri: "file:///file2.txt", name: "" },
          { type: "resource_link", uri: "file:///file3.txt", name: "" },
        ],
      };

      const namespaced = namespaceCallToolResultResources("files", result);

      expect((namespaced.content[0] as { uri: string }).uri).toBe(
        "gw://files/file:///file1.txt",
      );
      expect((namespaced.content[1] as { uri: string }).uri).toBe(
        "gw://files/file:///file2.txt",
      );
      expect((namespaced.content[2] as { uri: string }).uri).toBe(
        "gw://files/file:///file3.txt",
      );
    });

    it("should preserve isError flag", () => {
      const result: CallToolResult = {
        content: [{ type: "text", text: "Error message" }],
        isError: true,
      };

      const namespaced = namespaceCallToolResultResources("server", result);

      expect(namespaced.isError).toBe(true);
      expect(namespaced.content).toHaveLength(1);
    });

    it("should preserve _meta if present", () => {
      const result: CallToolResult = {
        content: [{ type: "text", text: "Test" }],
        _meta: {
          progress: 0.5,
        } as CallToolResult["_meta"],
      };

      const namespaced = namespaceCallToolResultResources("server", result);

      expect(namespaced._meta).toBeDefined();
    });

    it("should handle empty content array", () => {
      const result: CallToolResult = {
        content: [],
      };

      const namespaced = namespaceCallToolResultResources("server", result);

      expect(namespaced.content).toEqual([]);
    });

    it("should handle null content blocks", () => {
      const result: CallToolResult = {
        content: [
          null as unknown as TextContent,
          { type: "text", text: "Valid text" },
        ],
      };

      const namespaced = namespaceCallToolResultResources("server", result);

      // Should preserve null blocks unchanged
      expect(namespaced.content[0]).toBeNull();
      expect(namespaced.content[1]).toEqual({
        type: "text",
        text: "Valid text",
      });
    });

    it("should handle non-object content blocks", () => {
      const result: CallToolResult = {
        content: [
          "string content" as unknown as TextContent,
          123 as unknown as TextContent,
          { type: "text", text: "Valid" },
        ],
      };

      const namespaced = namespaceCallToolResultResources("server", result);

      expect(namespaced.content[0]).toBe("string content");
      expect(namespaced.content[1]).toBe(123);
      expect(namespaced.content[2]).toEqual({ type: "text", text: "Valid" });
    });

    it("should handle content blocks without type property", () => {
      const result: CallToolResult = {
        content: [
          { text: "No type property" } as unknown as TextContent,
          { type: "text", text: "Valid" },
        ],
      };

      const namespaced = namespaceCallToolResultResources("server", result);

      expect(namespaced.content[0]).toEqual({ text: "No type property" });
      expect(namespaced.content[1]).toEqual({ type: "text", text: "Valid" });
    });

    it("should handle resource_link blocks without uri", () => {
      const result: CallToolResult = {
        content: [
          {
            type: "resource_link",
            name: "test",
          } as { type: string; name: string },
        ],
      } as CallToolResult;

      const namespaced = namespaceCallToolResultResources("server", result);

      // Should return unchanged (no uri to namespace)
      expect((namespaced.content[0] as { type: string }).type).toBe(
        "resource_link",
      );
    });

    it("should handle resource blocks without resource property", () => {
      const result: CallToolResult = {
        content: [
          {
            type: "resource",
          } as { type: string; resource?: { uri: string } },
        ],
      } as CallToolResult;

      const namespaced = namespaceCallToolResultResources("server", result);

      // Should return unchanged
      expect((namespaced.content[0] as { type: string }).type).toBe("resource");
    });

    it("should handle resource blocks with null resource", () => {
      // @ts-expect-error Testing with null resource (malformed data)
      const result: CallToolResult = {
        content: [
          {
            type: "resource",
            resource: null,
          },
        ],
      } as CallToolResult;

      const namespaced = namespaceCallToolResultResources("server", result);

      expect(
        (namespaced.content[0] as { type: string; resource: unknown }).resource,
      ).toBeNull();
    });

    it("should handle resource blocks with resource missing uri", () => {
      const result: CallToolResult = {
        content: [
          {
            type: "resource",
            resource: {
              text: "No URI",
            },
          } as unknown as { type: string; resource: { uri: string } },
        ],
      } as CallToolResult;

      const namespaced = namespaceCallToolResultResources("server", result);

      // Should return unchanged (no uri to namespace)
      expect(
        (namespaced.content[0] as { type: string; resource: { text: string } })
          .resource.text,
      ).toBe("No URI");
    });

    it("should not mutate the original result object", () => {
      const result: CallToolResult = {
        content: [{ type: "resource_link", uri: "file:///test.txt", name: "" }],
      };

      const originalUri = (result.content[0] as { uri: string }).uri;
      namespaceCallToolResultResources("server", result);

      expect((result.content[0] as { uri: string }).uri).toBe(originalUri);
    });
  });

  describe("namespaceGetPromptResultResources", () => {
    it("should namespace resource_link in message content", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource_link",
              uri: "file:///doc.txt",
              name: "",
            },
          },
        ],
      };

      const namespaced = namespaceGetPromptResultResources("docs", result);

      expect(
        (
          namespaced.messages[0]!.content as {
            type: string;
            uri: string | undefined;
          }
        ).uri!,
      ).toBe("gw://docs/file:///doc.txt");
    });

    it("should namespace embedded resource in message content", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource",
              resource: {
                uri: "file:///data.json",
                text: "data content",
              },
            },
          },
        ],
      };

      const namespaced = namespaceGetPromptResultResources("api", result);

      // @ts-expect-error Content type assertion for defensive test
      const content = namespaced.messages[0].content as {
        type: string;
        resource?: { uri: string; text: string };
      };
      expect(content.resource?.uri).toBe("gw://api/file:///data.json");
    });

    it("should handle multiple messages", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource_link",
              uri: "file:///file1.txt",
              name: "",
            },
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: "Here's the file",
            },
          },
          {
            role: "user",
            content: {
              type: "resource_link",
              uri: "file:///file2.txt",
              name: "",
            },
          },
        ],
      };

      const namespaced = namespaceGetPromptResultResources("files", result);

      expect(
        (namespaced.messages[0]!.content as { uri: string | undefined }).uri!,
      ).toBe("gw://files/file:///file1.txt");
      expect(namespaced.messages[1]!.content).toEqual({
        type: "text",
        text: "Here's the file",
      });
      expect(
        (namespaced.messages[2]!.content as { uri: string | undefined }).uri!,
      ).toBe("gw://files/file:///file2.txt");
    });

    it("should handle messages with text content (no resources)", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Just regular text",
            },
          },
        ],
      };

      const namespaced = namespaceGetPromptResultResources("server", result);

      // @ts-expect-error Content type assertion for defensive test
      const content = namespaced.messages[0].content as {
        type: string;
        text: string;
      };
      expect(content.type).toBe("text");
      expect(content.text).toBe("Just regular text");
    });

    it("should preserve _meta if present", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Test" },
          },
        ],
        _meta: {
          someMetadata: "value",
        } as GetPromptResult["_meta"],
      };

      const namespaced = namespaceGetPromptResultResources("server", result);

      expect(namespaced._meta).toBeDefined();
    });

    it("should handle messages with non-object content", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: "string content" as unknown as TextContent,
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: "Valid response",
            },
          },
        ],
      };

      const namespaced = namespaceGetPromptResultResources("server", result);

      // @ts-expect-error Content type assertion for defensive test
      expect(namespaced.messages[0].content).toBe("string content");
      // @ts-expect-error Content type assertion for defensive test
      const content = namespaced.messages[1].content as {
        type: string;
        text: string;
      };
      expect(content.type).toBe("text");
      expect(content.text).toBe("Valid response");
    });

    it("should handle messages with null content", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: null as unknown as TextContent,
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: "Response",
            },
          },
        ],
      };

      const namespaced = namespaceGetPromptResultResources("server", result);

      // Should return message unchanged
      // @ts-expect-error Content type assertion for defensive test
      expect(namespaced.messages[0].content).toBeNull();
      // @ts-expect-error Content type assertion for defensive test
      const content = namespaced.messages[1].content as {
        type: string;
        text: string;
      };
      expect(content.type).toBe("text");
      expect(content.text).toBe("Response");
    });

    it("should handle messages with content missing type property", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              text: "No type field",
            } as unknown as TextContent,
          },
        ],
      };

      const namespaced = namespaceGetPromptResultResources("server", result);

      // @ts-expect-error Content type assertion for defensive test
      const content = namespaced.messages[0].content as { text: string };
      expect(content.text).toBe("No type field");
    });

    it("should handle resource_link messages without uri", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource_link",
            } as { type: string; name: string },
          },
        ],
      } as GetPromptResult;

      const namespaced = namespaceGetPromptResultResources("server", result);

      // Should return unchanged (no uri to namespace)
      // @ts-expect-error Content type assertion for defensive test
      expect((namespaced.messages[0].content as { type: string }).type).toBe(
        "resource_link",
      );
    });

    it("should handle resource messages without resource property", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource",
            } as { type: string; resource?: { uri: string } },
          },
        ],
      } as GetPromptResult;

      const namespaced = namespaceGetPromptResultResources("server", result);

      // Should return unchanged
      // @ts-expect-error Content type assertion for defensive test
      const content = namespaced.messages[0].content as { type: string };
      expect(content.type).toBe("resource");
    });

    it("should handle resource messages with null resource", () => {
      const result = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource",
              resource: null,
            },
          },
        ],
      } as unknown as GetPromptResult;

      const namespaced = namespaceGetPromptResultResources("server", result);

      // @ts-expect-error Content type assertion for defensive test
      const content = namespaced.messages[0].content as {
        type: string;
        resource: unknown;
      };
      expect(content.resource).toBeNull();
    });

    it("should handle resource messages with resource missing uri", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource",
              resource: {
                text: "No URI",
              },
            } as unknown as { type: string; resource: { uri: string } },
          },
        ],
      } as GetPromptResult;

      const namespaced = namespaceGetPromptResultResources("server", result);

      // Should return unchanged (no uri to namespace)
      // @ts-expect-error Content type assertion for defensive test
      const content = namespaced.messages[0].content as {
        type: string;
        resource: { text: string };
      };
      expect(content.resource.text).toBe("No URI");
    });

    it("should not mutate the original result object", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource_link",
              uri: "file:///test.txt",
              name: "",
            },
          },
        ],
      };

      const originalUri = (
        result.messages[0]!.content as { uri: string | undefined }
      )?.uri;
      namespaceGetPromptResultResources("server", result);

      // @ts-expect-error Content type assertion for defensive test
      const content = result.messages[0].content as { uri: string };
      expect(content.uri).toBe(originalUri!);
    });
  });

  describe("integration scenarios", () => {
    it("should handle complex tool result with multiple content types", () => {
      const result: CallToolResult = {
        content: [
          { type: "text", text: "Processing resources..." },
          { type: "resource_link", uri: "file:///data1.json", name: "" },
          {
            type: "resource",
            resource: { uri: "file:///data2.json", text: "content" },
          },
          { type: "text", text: "Done!" },
        ],
        isError: false,
      };

      const namespaced = namespaceCallToolResultResources("api", result);

      expect(namespaced.content[0]).toEqual({
        type: "text",
        text: "Processing resources...",
      });
      expect((namespaced.content[1] as { uri: string }).uri).toBe(
        "gw://api/file:///data1.json",
      );
      expect(
        (namespaced.content[2] as { resource: { uri: string } }).resource.uri,
      ).toBe("gw://api/file:///data2.json");
      expect(namespaced.content[3]).toEqual({ type: "text", text: "Done!" });
      expect(namespaced.isError).toBe(false);
    });

    it("should handle prompt result with mixed messages", () => {
      const result: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Show me files" },
          },
          {
            role: "assistant",
            content: {
              type: "resource_link",
              uri: "file:///document.txt",
              name: "",
            },
          },
          {
            role: "user",
            content: {
              type: "resource",
              resource: { uri: "file:///data.json", text: "data" },
            },
          },
        ],
      };

      const namespaced = namespaceGetPromptResultResources("files", result);

      // @ts-expect-error Content type assertions for defensive test
      const content0 = namespaced.messages[0].content as {
        type: string;
        text: string;
      };
      expect(content0.type).toBe("text");
      expect(content0.text).toBe("Show me files");

      // @ts-expect-error Content type assertion for defensive test
      const content1 = namespaced.messages[1].content as {
        uri: string | undefined;
      };
      expect(content1.uri!).toBe("gw://files/file:///document.txt");

      // @ts-expect-error Content type assertion for defensive test
      const content2 = namespaced.messages[2].content as {
        resource: { uri: string } | undefined;
      };
      expect(content2.resource?.uri).toBe("gw://files/file:///data.json");
    });

    it("should round-trip: namespace then parse", () => {
      const serverName = "test-server";
      const originalUri = "file:///document.txt";

      const namespaced = namespaceResourceUri(serverName, originalUri);
      const parsed = parseResourceUri(namespaced);

      expect(parsed).toEqual({
        serverName,
        originalUri,
      });
    });
  });

  // ===========================================================================
  // Skill URI Utilities
  // ===========================================================================

  describe("SKILL_URI_SCHEME", () => {
    it("should be gw-skill://", () => {
      expect(SKILL_URI_SCHEME).toBe("gw-skill://");
    });
  });

  describe("createSkillResourceUri", () => {
    it("should create a skill URI without path", () => {
      const result = createSkillResourceUri("pdf-rotation");

      expect(result).toBe("gw-skill://pdf-rotation");
    });

    it("should create a skill URI with path", () => {
      const result = createSkillResourceUri(
        "pdf-rotation",
        "scripts/rotate.py",
      );

      expect(result).toBe("gw-skill://pdf-rotation/scripts/rotate.py");
    });

    it("should handle nested paths", () => {
      const result = createSkillResourceUri(
        "my-skill",
        "references/api/endpoints.md",
      );

      expect(result).toBe("gw-skill://my-skill/references/api/endpoints.md");
    });

    it("should handle empty path as no path", () => {
      const result = createSkillResourceUri("test-skill", "");

      expect(result).toBe("gw-skill://test-skill");
    });

    it("should handle skill names with hyphens", () => {
      const result = createSkillResourceUri("my-cool-skill");

      expect(result).toBe("gw-skill://my-cool-skill");
    });

    it("should handle paths with special characters", () => {
      const result = createSkillResourceUri(
        "skill",
        "assets/file with spaces.txt",
      );

      expect(result).toBe("gw-skill://skill/assets/file with spaces.txt");
    });
  });

  describe("parseSkillResourceUri", () => {
    it("should parse a skill URI without path", () => {
      const result = parseSkillResourceUri("gw-skill://pdf-rotation");

      expect(result).toEqual({ skillName: "pdf-rotation" });
    });

    it("should parse a skill URI with path", () => {
      const result = parseSkillResourceUri(
        "gw-skill://pdf-rotation/scripts/rotate.py",
      );

      expect(result).toEqual({
        skillName: "pdf-rotation",
        path: "scripts/rotate.py",
      });
    });

    it("should parse nested paths correctly", () => {
      const result = parseSkillResourceUri(
        "gw-skill://my-skill/references/api/endpoints.md",
      );

      expect(result).toEqual({
        skillName: "my-skill",
        path: "references/api/endpoints.md",
      });
    });

    it("should return null for non-skill URIs", () => {
      expect(parseSkillResourceUri("gw://server/resource")).toBeNull();
      expect(parseSkillResourceUri("file:///path/to/file")).toBeNull();
      expect(parseSkillResourceUri("https://example.com")).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(parseSkillResourceUri("")).toBeNull();
    });

    it("should return null for just the scheme", () => {
      expect(parseSkillResourceUri("gw-skill://")).toBeNull();
    });

    it("should return null for malformed URIs", () => {
      expect(parseSkillResourceUri("skill:")).toBeNull();
      expect(parseSkillResourceUri("skill:/")).toBeNull();
      expect(parseSkillResourceUri("skill")).toBeNull();
    });

    it("should handle trailing slash as empty path (returns just skillName)", () => {
      const result = parseSkillResourceUri("gw-skill://my-skill/");

      expect(result).toEqual({ skillName: "my-skill" });
    });

    it("should handle skill names with hyphens and underscores", () => {
      expect(parseSkillResourceUri("gw-skill://my-cool_skill")).toEqual({
        skillName: "my-cool_skill",
      });
    });
  });

  describe("isSkillResourceUri", () => {
    it("should return true for skill URIs", () => {
      expect(isSkillResourceUri("gw-skill://pdf-rotation")).toBe(true);
      expect(isSkillResourceUri("gw-skill://my-skill/scripts/run.py")).toBe(
        true,
      );
    });

    it("should return false for MCP server URIs", () => {
      expect(isSkillResourceUri("gw://server/resource")).toBe(false);
    });

    it("should return false for file URIs", () => {
      expect(isSkillResourceUri("file:///path/to/file")).toBe(false);
    });

    it("should return false for http URIs", () => {
      expect(isSkillResourceUri("https://example.com")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isSkillResourceUri("")).toBe(false);
    });

    it("should return false for partial skill scheme", () => {
      expect(isSkillResourceUri("skill:")).toBe(false);
      expect(isSkillResourceUri("skill:/")).toBe(false);
    });
  });

  describe("skill URI round-trip", () => {
    it("should round-trip: create then parse (without path)", () => {
      const skillName = "test-skill";

      const uri = createSkillResourceUri(skillName);
      const parsed = parseSkillResourceUri(uri);

      expect(parsed).toEqual({ skillName });
    });

    it("should round-trip: create then parse (with path)", () => {
      const skillName = "test-skill";
      const path = "scripts/run.py";

      const uri = createSkillResourceUri(skillName, path);
      const parsed = parseSkillResourceUri(uri);

      expect(parsed).toEqual({ skillName, path });
    });

    it("should round-trip: create then parse (with nested path)", () => {
      const skillName = "complex-skill";
      const path = "references/api/v2/endpoints.md";

      const uri = createSkillResourceUri(skillName, path);
      const parsed = parseSkillResourceUri(uri);

      expect(parsed).toEqual({ skillName, path });
    });
  });
});
