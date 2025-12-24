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
 * @injectable()
 * class MyService {
 *   constructor(
 *     @$inject('Logger') private logger: ILogger
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
 * @injectable()
 * class MyService {
 *   constructor(
 *     @$multiInject('Tool') private tools: ITool[]
 *   ) {}
 * }
 * ```
 */
export const $multiInject =
  multiInject as TypedMultiInject<ContainerBindingMap>;
