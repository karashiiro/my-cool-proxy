import { render, screen } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import ResultPane from "./ResultPane.svelte";

describe("ResultPane", () => {
  it("renders JSON result as formatted output", () => {
    render(ResultPane, {
      props: {
        result: '{"key":"value","nested":{"a":1}}',
        error: undefined,
        label: "Script Result",
      },
    });
    expect(screen.getByText(/Script Result/)).toBeInTheDocument();
    expect(screen.getByText(/key/)).toBeInTheDocument();
    expect(screen.getByText(/value/)).toBeInTheDocument();
  });

  it("renders error message with error styling", () => {
    render(ResultPane, {
      props: {
        result: undefined,
        error: "Something went wrong",
        label: "Script Result",
      },
    });
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });

  it("handles non-JSON result gracefully (raw text)", () => {
    render(ResultPane, {
      props: {
        result: "plain text result",
        error: undefined,
        label: "Script Result",
      },
    });
    expect(screen.getByText(/plain text result/)).toBeInTheDocument();
  });

  it("shows tool call context in label", () => {
    render(ResultPane, {
      props: {
        result: "42",
        error: undefined,
        label: "Tool Call: server.tool",
      },
    });
    expect(screen.getByText(/Tool Call: server\.tool/)).toBeInTheDocument();
  });

  it("renders empty state when no result or error", () => {
    render(ResultPane, {
      props: { result: undefined, error: undefined, label: "Script Result" },
    });
    expect(screen.getByText(/no result/i)).toBeInTheDocument();
  });

  it("renders MCP content array with text blocks", () => {
    const content = JSON.stringify({
      content: [
        { type: "text", text: "Hello from MCP" },
        { type: "text", text: "Second block" },
      ],
    });
    render(ResultPane, {
      props: { result: content, error: undefined, label: "Script Result" },
    });
    expect(screen.getByText("Hello from MCP")).toBeInTheDocument();
    expect(screen.getByText("Second block")).toBeInTheDocument();
  });

  it("renders MCP content array with image blocks as img elements", () => {
    const content = JSON.stringify({
      content: [{ type: "image", data: "dGVzdA==", mimeType: "image/png" }],
    });
    const { container } = render(ResultPane, {
      props: { result: content, error: undefined, label: "Script Result" },
    });
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,dGVzdA==");
  });

  it("falls back to JSON display for non-content objects", () => {
    const result = JSON.stringify({ calculation: { text: "100 - 25 = 75" } });
    render(ResultPane, {
      props: { result, error: undefined, label: "Script Result" },
    });
    expect(screen.getByText(/calculation/)).toBeInTheDocument();
  });
});
