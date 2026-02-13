import { describe, it, expect } from "vitest";
import {
  namespacePromptName,
  parsePromptName,
  namespacePrompt,
} from "./prompt-name.js";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

describe("prompt-name utilities", () => {
  describe("namespacePromptName", () => {
    it("should namespace a prompt name with server name prefix", () => {
      const result = namespacePromptName("docs-server", "code-review");
      expect(result).toBe("docs-server/code-review");
    });

    it("should handle server names with special characters", () => {
      const result = namespacePromptName("my-cool_server", "prompt-1");
      expect(result).toBe("my-cool_server/prompt-1");
    });

    it("should handle prompt names with special characters", () => {
      const result = namespacePromptName("server", "my-prompt_v2");
      expect(result).toBe("server/my-prompt_v2");
    });

    it("should handle empty server name", () => {
      const result = namespacePromptName("", "prompt");
      expect(result).toBe("/prompt");
    });

    it("should handle empty prompt name", () => {
      const result = namespacePromptName("server", "");
      expect(result).toBe("server/");
    });
  });

  describe("parsePromptName", () => {
    it("should parse a valid namespaced prompt name", () => {
      const result = parsePromptName("docs-server/code-review");

      expect(result).toEqual({
        serverName: "docs-server",
        originalName: "code-review",
      });
    });

    it("should handle prompt names containing slashes", () => {
      // Uses first slash as delimiter
      const result = parsePromptName("server/path/to/prompt");

      expect(result).toEqual({
        serverName: "server",
        originalName: "path/to/prompt",
      });
    });

    it("should return null when no slash is present", () => {
      const result = parsePromptName("no-namespace-here");
      expect(result).toBeNull();
    });

    it("should return null when server name is empty (starts with slash)", () => {
      const result = parsePromptName("/just-prompt");
      expect(result).toBeNull();
    });

    it("should return null when original name is empty (ends with slash)", () => {
      const result = parsePromptName("server/");
      expect(result).toBeNull();
    });

    it("should handle server names with dashes and underscores", () => {
      const result = parsePromptName("my-cool_server/test-prompt");

      expect(result).toEqual({
        serverName: "my-cool_server",
        originalName: "test-prompt",
      });
    });

    it("should handle single character names", () => {
      const result = parsePromptName("a/b");

      expect(result).toEqual({
        serverName: "a",
        originalName: "b",
      });
    });
  });

  describe("namespacePrompt", () => {
    it("should transform a prompt object with namespaced name", () => {
      const prompt: Prompt = {
        name: "code-review",
        description: "Review code for best practices",
      };

      const result = namespacePrompt("docs-server", prompt);

      expect(result).toEqual({
        name: "docs-server/code-review",
        description: "Review code for best practices",
      });
    });

    it("should preserve all other prompt properties", () => {
      const prompt: Prompt = {
        name: "summarize",
        description: "Create a summary of text",
        arguments: [
          {
            name: "text",
            description: "Text to summarize",
            required: true,
          },
          {
            name: "length",
            description: "Summary length",
            required: false,
          },
        ],
      };

      const result = namespacePrompt("ai-server", prompt);

      expect(result.name).toBe("ai-server/summarize");
      expect(result.description).toBe("Create a summary of text");
      expect(result.arguments).toEqual(prompt.arguments);
    });

    it("should not mutate the original prompt object", () => {
      const originalPrompt: Prompt = {
        name: "original-name",
        description: "Original description",
      };

      const result = namespacePrompt("server", originalPrompt);

      expect(originalPrompt.name).toBe("original-name");
      expect(result.name).toBe("server/original-name");
    });

    it("should handle prompt without description", () => {
      const prompt: Prompt = {
        name: "minimal",
      };

      const result = namespacePrompt("server", prompt);

      expect(result).toEqual({
        name: "server/minimal",
      });
    });
  });
});
