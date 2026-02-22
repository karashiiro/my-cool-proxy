import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Snippet } from "svelte";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "Unknown";
  const diff = Date.now() - timestamp;
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Helper type used by shadcn-svelte components.
 * Adds an optional `ref` bindable and a `children` snippet.
 */
export type WithElementRef<T, El extends HTMLElement = HTMLElement> = T & {
  ref?: El | null;
  children?: Snippet;
};

/**
 * Helper type that removes `child` and `children` from a type
 * and adds back our standard `children` snippet.
 */
export type WithoutChild<T> = Omit<T, "child" | "children"> & {
  children?: Snippet;
};
