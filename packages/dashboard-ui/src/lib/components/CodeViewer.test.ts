import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import CodeViewer from "./CodeViewer.svelte";

// Mock Shiki to avoid WASM loading in tests
vi.mock("$lib/highlight.js", () => ({
  highlightLua: vi.fn(
    async (code: string) => `<pre><code>${code}</code></pre>`,
  ),
}));

describe("CodeViewer", () => {
  it("renders the script code", async () => {
    render(CodeViewer, { props: { script: 'result("test")', toolCalls: [] } });
    expect(await screen.findByText(/result\("test"\)/)).toBeInTheDocument();
  });

  it("renders empty state when no script is provided", () => {
    render(CodeViewer, { props: { script: "", toolCalls: [] } });
    expect(screen.getByText(/select an execution/i)).toBeInTheDocument();
  });

  it("emits ontoolcallclick with null when clicking non-tool-call area", async () => {
    const user = userEvent.setup();
    const ontoolcallclick = vi.fn();
    render(CodeViewer, {
      props: { script: "result(1)", toolCalls: [], ontoolcallclick },
    });
    const codeArea = await screen.findByText(/result\(1\)/);
    await user.click(codeArea);
    expect(ontoolcallclick).toHaveBeenCalledWith(null);
  });
});
