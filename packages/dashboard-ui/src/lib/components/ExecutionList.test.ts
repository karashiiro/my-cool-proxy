import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ExecutionList from "./ExecutionList.svelte";
import type { LuaExecution } from "$lib/types.js";

const mockExecutions: LuaExecution[] = [
  {
    executionId: "exec1",
    sessionId: "s1",
    script: 'result("hello")',
    status: "success",
    result: '"hello"',
    createdAt: Date.now(),
  },
  {
    executionId: "exec2",
    sessionId: "s1",
    script: 'error("boom")',
    status: "error",
    error: "boom",
    createdAt: Date.now() - 1000,
  },
];

describe("ExecutionList", () => {
  it("renders execution items", () => {
    render(ExecutionList, {
      props: { executions: mockExecutions, selectedId: null },
    });
    expect(screen.getByText(/result\("hello"\)/)).toBeInTheDocument();
    expect(screen.getByText(/error\("boom"\)/)).toBeInTheDocument();
  });

  it("shows status badges", () => {
    render(ExecutionList, {
      props: { executions: mockExecutions, selectedId: null },
    });
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("calls onselect when an execution is clicked", async () => {
    const user = userEvent.setup();
    const onselect = vi.fn();
    render(ExecutionList, {
      props: { executions: mockExecutions, selectedId: null, onselect },
    });
    await user.click(screen.getByText(/result\("hello"\)/));
    expect(onselect).toHaveBeenCalledWith("exec1");
  });

  it("highlights the selected execution", () => {
    render(ExecutionList, {
      props: { executions: mockExecutions, selectedId: "exec1" },
    });
    const selectedItem = screen
      .getByText(/result\("hello"\)/)
      .closest("[data-selected]");
    expect(selectedItem).toBeTruthy();
  });

  it("renders empty state when no executions", () => {
    render(ExecutionList, {
      props: { executions: [], selectedId: null },
    });
    expect(screen.getByText(/no executions/i)).toBeInTheDocument();
  });

  it("shows filter button when tools are provided", () => {
    render(ExecutionList, {
      props: {
        executions: mockExecutions,
        selectedId: null,
        tools: [
          { tool: "github.search_code", count: 5 },
          { tool: "context7.query_docs", count: 3 },
        ],
      },
    });
    expect(screen.getByLabelText("Filter by tool")).toBeInTheDocument();
  });

  it("does not show filter button when tools list is empty", () => {
    render(ExecutionList, {
      props: { executions: mockExecutions, selectedId: null, tools: [] },
    });
    expect(screen.queryByLabelText("Filter by tool")).not.toBeInTheDocument();
  });

  it("shows filtered empty state message", () => {
    render(ExecutionList, {
      props: {
        executions: [],
        selectedId: null,
        activeFilter: "github.search_code",
      },
    });
    expect(screen.getByText(/no executions match/i)).toBeInTheDocument();
  });

  it("shows active filter chip with clear button", () => {
    render(ExecutionList, {
      props: {
        executions: mockExecutions,
        selectedId: null,
        activeFilter: "github.search_code",
        tools: [{ tool: "github.search_code", count: 5 }],
      },
    });
    expect(screen.getByText("Filtered by:")).toBeInTheDocument();
    expect(screen.getByLabelText("Clear filter: github.search_code")).toBeInTheDocument();
  });

  it("calls onfilter with null when clear filter is clicked", async () => {
    const user = userEvent.setup();
    const onfilter = vi.fn();
    render(ExecutionList, {
      props: {
        executions: mockExecutions,
        selectedId: null,
        activeFilter: "github.search_code",
        tools: [{ tool: "github.search_code", count: 5 }],
        onfilter,
      },
    });
    await user.click(screen.getByLabelText("Clear filter: github.search_code"));
    expect(onfilter).toHaveBeenCalledWith(null);
  });

  it("calls onfilter with tool name when a tool is selected from dropdown", async () => {
    const user = userEvent.setup();
    const onfilter = vi.fn();
    render(ExecutionList, {
      props: {
        executions: mockExecutions,
        selectedId: null,
        tools: [
          { tool: "github.search_code", count: 5 },
          { tool: "context7.query_docs", count: 3 },
        ],
        onfilter,
      },
    });
    // Open the dropdown
    await user.click(screen.getByLabelText("Filter by tool"));
    // Select a tool
    await user.click(screen.getByRole("option", { name: /context7\.query_docs/ }));
    expect(onfilter).toHaveBeenCalledWith("context7.query_docs");
  });

  it("updates filter button aria-label when filter is active", () => {
    render(ExecutionList, {
      props: {
        executions: mockExecutions,
        selectedId: null,
        activeFilter: "github.search_code",
        tools: [{ tool: "github.search_code", count: 5 }],
      },
    });
    expect(screen.getByLabelText("Filtered by github.search_code")).toBeInTheDocument();
  });
});
