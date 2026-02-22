import "@testing-library/jest-dom/vitest";

// Polyfill ResizeObserver for jsdom (used by bits-ui's ScrollArea)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
