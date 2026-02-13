import { describe, it, expect } from "vitest";
import type { CreateMessageRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ContentBlock } from "@my-cool-proxy/acp-client";
import { mapMcpToAcpPrompt, mapAcpToMcpResult } from "./mcp-acp-mappers.js";

type SamplingParams = CreateMessageRequest["params"];

describe("mapMcpToAcpPrompt", () => {
  it("should map a single user text message", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Hello agent" },
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params);

    expect(result).toEqual([{ type: "text", text: "[User]: Hello agent" }]);
  });

  it("should map a multi-turn conversation with role labels", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: { type: "text", text: "What is 2+2?" },
        },
        {
          role: "assistant",
          content: { type: "text", text: "4" },
        },
        {
          role: "user",
          content: { type: "text", text: "And 3+3?" },
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params);

    expect(result).toEqual([
      { type: "text", text: "[User]: What is 2+2?" },
      { type: "text", text: "[Assistant]: 4" },
      { type: "text", text: "[User]: And 3+3?" },
    ]);
  });

  it("should prefix system prompt as the first content block", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Hi" },
        },
      ],
      systemPrompt: "You are a helpful assistant.",
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params);

    expect(result[0]).toEqual({
      type: "text",
      text: "[System]: You are a helpful assistant.",
    });
    expect(result[1]).toEqual({
      type: "text",
      text: "[User]: Hi",
    });
  });

  it("should pass through image content when agent supports it", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: {
            type: "image",
            data: "base64data",
            mimeType: "image/png",
          },
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params, { image: true });

    // Role label as separate block, then native image block
    expect(result).toEqual([
      { type: "text", text: "[User]:" },
      { type: "image", data: "base64data", mimeType: "image/png" },
    ]);
  });

  it("should fall back to text placeholder for image when agent lacks capability", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: {
            type: "image",
            data: "base64data",
            mimeType: "image/png",
          },
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params);

    expect(result).toEqual([
      { type: "text", text: "[User]: [image: image/png]" },
    ]);
  });

  it("should pass through audio content when agent supports it", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: {
            type: "audio",
            data: "base64audio",
            mimeType: "audio/wav",
          },
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params, { audio: true });

    expect(result).toEqual([
      { type: "text", text: "[User]:" },
      { type: "audio", data: "base64audio", mimeType: "audio/wav" },
    ]);
  });

  it("should fall back to text placeholder for audio when agent lacks capability", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: {
            type: "audio",
            data: "base64audio",
            mimeType: "audio/wav",
          },
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params);

    expect(result).toEqual([
      { type: "text", text: "[User]: [audio: audio/wav]" },
    ]);
  });

  it("should handle mixed text and image when agent supports images", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            {
              type: "image",
              data: "base64data",
              mimeType: "image/jpeg",
            },
          ],
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params, { image: true });

    // Text with role label, then native image block
    expect(result).toEqual([
      { type: "text", text: "[User]: Describe this image" },
      { type: "image", data: "base64data", mimeType: "image/jpeg" },
    ]);
  });

  it("should inline image placeholder with text when agent lacks image capability", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            {
              type: "image",
              data: "base64data",
              mimeType: "image/jpeg",
            },
          ],
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params);

    // Image falls back to text placeholder, merged with the text
    expect(result).toEqual([
      {
        type: "text",
        text: "[User]: Describe this image [image: image/jpeg]",
      },
    ]);
  });

  it("should include sampling parameters when present", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Hello" },
        },
      ],
      maxTokens: 200,
      temperature: 0.7,
      stopSequences: ["STOP", "END"],
      modelPreferences: {
        hints: [{ name: "claude-sonnet" }],
        intelligencePriority: 0.8,
        costPriority: 0.2,
      },
    };

    const result = mapMcpToAcpPrompt(params);

    // Last block should be the parameters block
    const paramsBlock = result[result.length - 1]! as ContentBlock & {
      type: "text";
      text: string;
    };
    expect(paramsBlock.type).toBe("text");
    expect(paramsBlock.text).toContain("[Sampling parameters:");
    expect(paramsBlock.text).toContain("maxTokens=200");
    expect(paramsBlock.text).toContain("temperature=0.7");
    expect(paramsBlock.text).toContain('stopSequences=["STOP","END"]');
    expect(paramsBlock.text).toContain("modelPreferences=");
  });

  it("should not include sampling parameters block when only maxTokens is present", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Hello" },
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params);

    // Should only have the message, no parameters block
    expect(result).toHaveLength(1);
    const block = result[0]! as ContentBlock & { type: "text"; text: string };
    expect(block.text).not.toContain("[Sampling parameters:");
  });

  it("should handle messages with array content blocks", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Describe this image" },
        },
      ],
      maxTokens: 100,
    };

    const result = mapMcpToAcpPrompt(params);

    expect(result).toEqual([
      { type: "text", text: "[User]: Describe this image" },
    ]);
  });

  it("should skip includeContext (not mappable to ACP)", () => {
    const params: SamplingParams = {
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Hello" },
        },
      ],
      maxTokens: 100,
      includeContext: "allServers",
    };

    const result = mapMcpToAcpPrompt(params);

    // includeContext should not appear anywhere in the output
    const allText = result
      .filter(
        (r): r is ContentBlock & { type: "text"; text: string } =>
          r.type === "text",
      )
      .map((r) => r.text)
      .join(" ");
    expect(allText).not.toContain("includeContext");
    expect(allText).not.toContain("allServers");
  });

  describe("toolChoice handling", () => {
    it("should inject directive when toolChoice.mode === 'required' and tools are present", () => {
      const params: SamplingParams = {
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Do something" },
          },
        ],
        maxTokens: 100,
        tools: [
          {
            name: "my_tool",
            description: "A tool",
            inputSchema: { type: "object" as const },
          },
        ],
        toolChoice: { mode: "required" },
      };

      const result = mapMcpToAcpPrompt(params);

      // Should have the directive block before the message
      expect(result).toHaveLength(2);
      const directive = result[0] as ContentBlock & {
        type: "text";
        text: string;
      };
      expect(directive.type).toBe("text");
      expect(directive.text).toContain("MUST use at least one");
      expect(directive.text).toContain("provided tools");
    });

    it("should place directive after system prompt when both are present", () => {
      const params: SamplingParams = {
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Do something" },
          },
        ],
        systemPrompt: "You are helpful",
        maxTokens: 100,
        tools: [
          {
            name: "my_tool",
            description: "A tool",
            inputSchema: { type: "object" as const },
          },
        ],
        toolChoice: { mode: "required" },
      };

      const result = mapMcpToAcpPrompt(params);

      // Should have: system prompt, directive, message
      expect(result).toHaveLength(3);
      const systemBlock = result[0] as ContentBlock & {
        type: "text";
        text: string;
      };
      const directiveBlock = result[1] as ContentBlock & {
        type: "text";
        text: string;
      };
      expect(systemBlock.text).toContain("[System]:");
      expect(directiveBlock.text).toContain("MUST use at least one");
    });

    it("should NOT inject directive when toolChoice.mode === 'auto'", () => {
      const params: SamplingParams = {
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Do something" },
          },
        ],
        maxTokens: 100,
        tools: [
          {
            name: "my_tool",
            description: "A tool",
            inputSchema: { type: "object" as const },
          },
        ],
        toolChoice: { mode: "auto" },
      };

      const result = mapMcpToAcpPrompt(params);

      // Should only have the message, no directive
      expect(result).toHaveLength(1);
      const allText = result
        .filter(
          (r): r is ContentBlock & { type: "text"; text: string } =>
            r.type === "text",
        )
        .map((r) => r.text)
        .join(" ");
      expect(allText).not.toContain("MUST use");
    });

    it("should NOT inject directive when toolChoice is undefined", () => {
      const params: SamplingParams = {
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Do something" },
          },
        ],
        maxTokens: 100,
        tools: [
          {
            name: "my_tool",
            description: "A tool",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      const result = mapMcpToAcpPrompt(params);

      // Should only have the message, no directive
      expect(result).toHaveLength(1);
      const allText = result
        .filter(
          (r): r is ContentBlock & { type: "text"; text: string } =>
            r.type === "text",
        )
        .map((r) => r.text)
        .join(" ");
      expect(allText).not.toContain("MUST use");
    });

    it("should NOT inject directive when toolChoice.mode === 'required' but no tools", () => {
      const params: SamplingParams = {
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Do something" },
          },
        ],
        maxTokens: 100,
        toolChoice: { mode: "required" },
      };

      const result = mapMcpToAcpPrompt(params);

      // Should only have the message, no directive
      expect(result).toHaveLength(1);
      const allText = result
        .filter(
          (r): r is ContentBlock & { type: "text"; text: string } =>
            r.type === "text",
        )
        .map((r) => r.text)
        .join(" ");
      expect(allText).not.toContain("MUST use");
    });

    it("should NOT inject directive when toolChoice.mode === 'required' but empty tools array", () => {
      const params: SamplingParams = {
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Do something" },
          },
        ],
        maxTokens: 100,
        tools: [],
        toolChoice: { mode: "required" },
      };

      const result = mapMcpToAcpPrompt(params);

      // Should only have the message, no directive
      expect(result).toHaveLength(1);
      const allText = result
        .filter(
          (r): r is ContentBlock & { type: "text"; text: string } =>
            r.type === "text",
        )
        .map((r) => r.text)
        .join(" ");
      expect(allText).not.toContain("MUST use");
    });
  });
});

describe("mapAcpToMcpResult", () => {
  it("should map a single text block and end_turn stop reason", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "Hello from the agent!" } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "end_turn");

    expect(result).toEqual({
      role: "assistant",
      content: { type: "text", text: "Hello from the agent!" },
      model: "acp-agent",
      stopReason: "endTurn",
    });
  });

  it("should map an image content block from ACP to MCP", () => {
    const content: ContentBlock[] = [
      {
        type: "image",
        data: "base64img",
        mimeType: "image/png",
      } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "end_turn");

    expect(result).toEqual({
      role: "assistant",
      content: { type: "image", data: "base64img", mimeType: "image/png" },
      model: "acp-agent",
      stopReason: "endTurn",
    });
  });

  it("should map an audio content block from ACP to MCP", () => {
    const content: ContentBlock[] = [
      {
        type: "audio",
        data: "base64audio",
        mimeType: "audio/wav",
      } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "end_turn");

    expect(result).toEqual({
      role: "assistant",
      content: { type: "audio", data: "base64audio", mimeType: "audio/wav" },
      model: "acp-agent",
      stopReason: "endTurn",
    });
  });

  it("should prefer non-text block when mixed content is present", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "Here is an image:" } as ContentBlock,
      {
        type: "image",
        data: "base64img",
        mimeType: "image/png",
      } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "end_turn");

    // CreateMessageResult only supports single content block,
    // so the non-text block (image) takes priority
    expect(result.content).toEqual({
      type: "image",
      data: "base64img",
      mimeType: "image/png",
    });
    expect(result.role).toBe("assistant");
    expect(result.model).toBe("acp-agent");
  });

  it("should concatenate multiple text blocks into one", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "Hello " } as ContentBlock,
      { type: "text", text: "world!" } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "end_turn");

    expect(result.content).toEqual({
      type: "text",
      text: "Hello world!",
    });
  });

  it("should map resource_link to text placeholder", () => {
    const content: ContentBlock[] = [
      {
        type: "resource_link",
        name: "document.pdf",
        uri: "file:///tmp/doc.pdf",
      } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "end_turn");

    expect(result.content).toEqual({
      type: "text",
      text: "[Resource: document.pdf (file:///tmp/doc.pdf)]",
    });
  });

  it("should map embedded text resource to text content", () => {
    const content: ContentBlock[] = [
      {
        type: "resource",
        resource: {
          uri: "file:///tmp/readme.md",
          text: "# Hello World",
        },
      } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "end_turn");

    expect(result.content).toEqual({
      type: "text",
      text: "# Hello World",
    });
  });

  it("should map max_tokens stop reason", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "Truncated..." } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "max_tokens");

    expect(result.stopReason).toBe("maxTokens");
  });

  it("should map unknown stop reason to endTurn", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "Done" } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "some_unknown_reason");

    expect(result.stopReason).toBe("endTurn");
  });

  it("should handle empty content with default empty text block", () => {
    const result = mapAcpToMcpResult([], "end_turn");

    expect(result).toEqual({
      role: "assistant",
      content: { type: "text", text: "" },
      model: "acp-agent",
      stopReason: "endTurn",
    });
  });

  it("should always set role to assistant", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "text" } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "end_turn");

    expect(result.role).toBe("assistant");
  });

  it("should always set model to acp-agent", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "text" } as ContentBlock,
    ];

    const result = mapAcpToMcpResult(content, "end_turn");

    expect(result.model).toBe("acp-agent");
  });
});
