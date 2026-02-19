import { injectable } from "inversify";
import type { IToolInspectionStore } from "../types/interfaces.js";

/**
 * In-memory store for tracking which upstream tools have been inspected
 * (via tool-details or inspect-tool-response) per session.
 *
 * Used to enforce that agents read tool documentation before invoking
 * tools in execute scripts. Tools are keyed as "luaServerName.luaToolName".
 */
@injectable()
export class ToolInspectionStore implements IToolInspectionStore {
  private inspected = new Map<string, Set<string>>();

  markInspected(
    sessionId: string,
    luaServerName: string,
    luaToolName: string,
  ): void {
    let tools = this.inspected.get(sessionId);
    if (!tools) {
      tools = new Set();
      this.inspected.set(sessionId, tools);
    }
    tools.add(`${luaServerName}.${luaToolName}`);
  }

  isInspected(
    sessionId: string,
    luaServerName: string,
    luaToolName: string,
  ): boolean {
    return (
      this.inspected.get(sessionId)?.has(`${luaServerName}.${luaToolName}`) ??
      false
    );
  }

  deleteSession(sessionId: string): void {
    this.inspected.delete(sessionId);
  }
}
