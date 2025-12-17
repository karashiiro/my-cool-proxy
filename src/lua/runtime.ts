import { injectable, inject } from "inversify";
import { LuaFactory, LuaEngine } from "wasmoon";
import type { ILuaRuntime, ILogger } from "../types/interfaces.js";
import { TYPES } from "../types/index.js";

@injectable()
export class WasmoonRuntime implements ILuaRuntime {
  private factory: LuaFactory;
  private engine: LuaEngine | null = null;

  constructor(@inject(TYPES.Logger) private logger: ILogger) {
    this.factory = new LuaFactory();
  }

  async executeScript(script: string): Promise<unknown> {
    try {
      const engine = await this.createEngine();
      await engine.doString(script);
      const result = engine.global.get("result");
      return result;
    } catch (error) {
      this.logger.error("Lua script execution failed", error as Error);
      throw error;
    }
  }

  private async createEngine(): Promise<LuaEngine> {
    const engine = await this.factory.createEngine();

    // Remove dangerous OS access
    engine.global.set("os", undefined);

    // Remove file I/O
    engine.global.set("io", undefined);

    // Remove module loading capabilities
    engine.global.set("require", undefined);
    engine.global.set("dofile", undefined);
    engine.global.set("loadfile", undefined);
    engine.global.set("package", undefined);

    // Remove debug facilities
    engine.global.set("debug", undefined);

    return engine;
  }

  async close(): Promise<void> {
    if (this.engine) {
      this.engine.global.close();
      this.engine = null;
      this.logger.info("Lua engine closed");
    }
  }
}
