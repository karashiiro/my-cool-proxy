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

  async getEngine(): Promise<LuaEngine> {
    if (!this.engine) {
      this.engine = await this.factory.createEngine();
      this.logger.info("Lua engine initialized");
    }
    return this.engine;
  }

  async executeScript(script: string): Promise<unknown> {
    const engine = await this.getEngine();
    try {
      await engine.doString(script);
      const result = engine.global.get("result");
      return result;
    } catch (error) {
      this.logger.error("Lua script execution failed", error as Error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.engine) {
      this.engine.global.close();
      this.engine = null;
      this.logger.info("Lua engine closed");
    }
  }
}
