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
});
