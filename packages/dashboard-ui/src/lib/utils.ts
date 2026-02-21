import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Snippet } from "svelte";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
