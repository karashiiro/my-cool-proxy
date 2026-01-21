import { inject, multiInject } from "inversify";
import type {
  TypedInject,
  TypedMultiInject,
} from "@inversifyjs/strongly-typed";
import type { ContainerBindingMap } from "./binding-map.js";

/**
 * Strongly-typed inject decorator.
 * Provides compile-time type checking for constructor and property injection.
 *
 * @example
 * ```typescript
 * import { TYPES } from "../types/index.js";
 *
 * @injectable()
 * class MyService {
 *   constructor(
 *     @$inject(TYPES.Logger) private logger: ILogger
 *   ) {}
 * }
 * ```
 */
export const $inject = inject as TypedInject<ContainerBindingMap>;

/**
 * Strongly-typed multi-inject decorator.
 * Used when multiple instances of a service are bound to the same identifier.
 *
 * @example
 * ```typescript
 * import { TYPES } from "../types/index.js";
 *
 * @injectable()
 * class MyService {
 *   constructor(
 *     @$multiInject(TYPES.Tool) private tools: ITool[]
 *   ) {}
 * }
 * ```
 */
export const $multiInject =
  multiInject as TypedMultiInject<ContainerBindingMap>;
