import { inject } from "inversify";
import type { TypedInject } from "@inversifyjs/strongly-typed";
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
