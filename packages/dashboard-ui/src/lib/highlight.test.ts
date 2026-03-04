import { describe, it, expect } from "vitest";
import { highlightLua } from "./highlight.js";

describe("highlightLua", () => {
  it("returns highlighted HTML for Lua code", async () => {
    const html = await highlightLua("local x = 1", []);
    expect(html).toContain("<pre");
    expect(html).toContain("local");
  });

  it("wraps tool call patterns with clickable buttons", async () => {
    const toolCalls = [
      {
        callId: "tc1",
        executionId: "e1",
        serverName: "srv",
        toolName: "tool",
        status: "success" as const,
        createdAt: Date.now(),
      },
    ];
    const html = await highlightLua(
      'local r = srv.tool({ key = "val" }):await()',
      toolCalls,
    );
    expect(html).toContain('data-call-id="tc1"');
    expect(html).toContain("button");
  });

  it("handles scripts with no tool calls", async () => {
    const html = await highlightLua("result(42)", []);
    expect(html).not.toContain("button");
  });

  it("matches tool calls when DB stores original names with hyphens", async () => {
    // The DB stores "data-server" (original MCP name) but Lua source has "data_server"
    const toolCalls = [
      {
        callId: "tc1",
        executionId: "e1",
        serverName: "data-server",
        toolName: "read_file",
        status: "success" as const,
        createdAt: Date.now(),
      },
    ];
    const html = await highlightLua(
      'local r = data_server.read_file({ path = "/tmp" }):await()',
      toolCalls,
    );
    expect(html).toContain('data-call-id="tc1"');
    expect(html).toContain("button");
  });

  it("matches tool calls when names have no special characters", async () => {
    const toolCalls = [
      {
        callId: "tc1",
        executionId: "e1",
        serverName: "calculator",
        toolName: "subtract",
        status: "success" as const,
        createdAt: Date.now(),
      },
    ];
    const html = await highlightLua(
      "local r = calculator.subtract({ a = 1 }):await()",
      toolCalls,
    );
    expect(html).toContain('data-call-id="tc1"');
  });

  it("wraps multiple tool calls in the same script", async () => {
    const toolCalls = [
      {
        callId: "tc1",
        executionId: "e1",
        serverName: "calculator",
        toolName: "subtract",
        status: "success" as const,
        createdAt: Date.now(),
      },
      {
        callId: "tc2",
        executionId: "e1",
        serverName: "data-server",
        toolName: "read-file",
        status: "success" as const,
        createdAt: Date.now(),
      },
    ];
    const script = [
      "local a = calculator.subtract({ a = 5, b = 3 }):await()",
      'local b = data_server.read_file({ path = "/tmp" }):await()',
      "result({ a, b })",
    ].join("\n");
    const html = await highlightLua(script, toolCalls);
    expect(html).toContain('data-call-id="tc1"');
    expect(html).toContain('data-call-id="tc2"');
  });

  it("matches hyphenated server names like stderr-server", async () => {
    const toolCalls = [
      {
        callId: "tc1",
        executionId: "e1",
        serverName: "stderr-server",
        toolName: "write_to_stderr",
        status: "success" as const,
        createdAt: Date.now(),
      },
    ];
    const html = await highlightLua(
      'local r = stderr_server.write_to_stderr({ message = "hi" }):await()',
      toolCalls,
    );
    expect(html).toContain('data-call-id="tc1"');
    expect(html).toContain("button");
  });

  it("matches long hyphenated server names", async () => {
    const toolCalls = [
      {
        callId: "tc1",
        executionId: "e1",
        serverName: "elicitation-test-server",
        toolName: "ask-user-url",
        status: "success" as const,
        createdAt: Date.now(),
      },
    ];
    const html = await highlightLua(
      "local r = elicitation_test_server.ask_user_url({}):await()",
      toolCalls,
    );
    expect(html).toContain('data-call-id="tc1"');
    expect(html).toContain("button");
  });

  it("preserves line breaks in multi-line scripts", async () => {
    const script = "local x = 1\nlocal y = 2\nresult(x + y)";
    const html = await highlightLua(script, []);
    // Should have multiple line spans
    const lineCount = (html.match(/<span class="line">/g) || []).length;
    expect(lineCount).toBe(3);
  });

  it("produces balanced HTML within buttons", async () => {
    const toolCalls = [
      {
        callId: "tc1",
        executionId: "e1",
        serverName: "stderr-server",
        toolName: "echo",
        status: "success" as const,
        createdAt: Date.now(),
      },
    ];
    const html = await highlightLua(
      'local r = stderr_server.echo({ message = "test" }):await()',
      toolCalls,
    );
    // Extract button content and verify balanced spans
    const btnMatch = html.match(/<button[^>]*>(.*?)<\/button>/s);
    expect(btnMatch).toBeTruthy();
    if (!btnMatch) throw new Error("Expected button match in HTML");
    const btnContent = btnMatch[1] ?? "";
    const openSpans = (btnContent.match(/<span[^>]*>/g) || []).length;
    const closeSpans = (btnContent.match(/<\/span>/g) || []).length;
    expect(openSpans).toBe(closeSpans);
  });
});
