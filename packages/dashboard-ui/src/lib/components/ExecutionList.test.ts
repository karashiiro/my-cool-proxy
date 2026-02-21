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
});
