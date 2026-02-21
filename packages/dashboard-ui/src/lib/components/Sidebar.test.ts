import { render, screen } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import Sidebar from "./Sidebar.svelte";

vi.mock("$app/state", () => ({
  page: { url: { pathname: "/" } },
}));

describe("Sidebar", () => {
  it("renders navigation links for Executions and Sessions", () => {
    render(Sidebar);
    expect(screen.getByRole("link", { name: "Executions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();
  });

  it("Executions link has href='/'", () => {
    render(Sidebar);
    const link = screen.getByRole("link", { name: "Executions" });
    expect(link).toHaveAttribute("href", "/");
  });

  it("Sessions link has href='/sessions'", () => {
    render(Sidebar);
    const link = screen.getByRole("link", { name: "Sessions" });
    expect(link).toHaveAttribute("href", "/sessions");
  });

  it("shows connected status indicator when wsConnected is true", () => {
    render(Sidebar, { props: { wsConnected: true } });
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-label", "WebSocket connected");
    const dot = status.querySelector(".status-dot");
    expect(dot).toHaveClass("connected");
  });

  it("shows disconnected status indicator when wsConnected is false", () => {
    render(Sidebar, { props: { wsConnected: false } });
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-label", "WebSocket disconnected");
    const dot = status.querySelector(".status-dot");
    expect(dot).toHaveClass("disconnected");
  });

  it("active nav item has aria-current='page' on the Executions link when on '/'", () => {
    render(Sidebar);
    const executionsLink = screen.getByRole("link", { name: "Executions" });
    expect(executionsLink).toHaveAttribute("aria-current", "page");
  });

  it("inactive nav item does not have aria-current='page'", () => {
    render(Sidebar);
    const sessionsLink = screen.getByRole("link", { name: "Sessions" });
    expect(sessionsLink).not.toHaveAttribute("aria-current", "page");
  });
});
