import { injectable } from "inversify";
import { formatSchema } from "../utils/schema-formatter.js";
import type { ServerListItem, ToolInfo } from "../types/interfaces.js";

@injectable()
export class MCPFormatterService {
  formatServerList(
    sessionId: string,
    serverList: Array<ServerListItem>,
  ): string {
    const lines = [
      `Session: ${sessionId}`,
      `Available MCP Servers: ${serverList.length}`,
      "",
    ];

    if (serverList.length === 0) {
      lines.push("No servers available in this session.");
      lines.push(
        "💡 Tip: Servers are configured when the session is initialized.",
      );
      return lines.join("\n");
    }

    for (const server of serverList) {
      if ("error" in server) {
        lines.push(
          `❌ ${server.luaIdentifier}`,
          `   Error: ${server.error}`,
          "",
        );
        continue;
      }

      lines.push(`📦 ${server.luaIdentifier}`);

      const fields: Array<[string, string | undefined]> = [
        ["Name", server.serverInfo.name],
        ["Version", server.serverInfo.version],
        [
          "Description",
          server.serverInfo.description || "(No description provided)",
        ],
        ["Instructions", server.serverInfo.instructions],
      ];

      for (const [label, value] of fields) {
        if (value) lines.push(`   ${label}: ${value}`);
      }

      lines.push("");
    }

    lines.push(
      "💡 Tip: Use list-server-tools to see available tools for each server",
    );

    return lines.join("\n");
  }

  formatToolList(luaServerName: string, tools: Array<ToolInfo>): string {
    const lines = [
      `Server: ${luaServerName}`,
      `Available Tools: ${tools.length}`,
      "",
    ];

    if (tools.length === 0) {
      lines.push("No tools available on this server.");
      return lines.join("\n");
    }

    for (const tool of tools) {
      lines.push(`🔧 ${tool.luaName}`);

      const description = tool.description || "(No description provided)";
      const truncated =
        description.length > 100
          ? `${description.slice(0, 100)}...`
          : description;
      lines.push(`   ${truncated}`);

      lines.push("");
    }

    lines.push(
      `💡 Tip: Use tool-details with luaServerName="${luaServerName}" to see full schemas`,
    );

    return lines.join("\n");
  }

  formatToolDetails(
    luaServerName: string,
    luaToolName: string,
    tool: {
      name: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    },
  ): string {
    const lines = [`Server: ${luaServerName}`, `Tool: ${luaToolName}`, ""];

    if (tool.description) {
      lines.push("Description:", tool.description, "");
    } else {
      lines.push("Description:", "(No description provided)", "");
    }

    if (tool.inputSchema) {
      lines.push("Input Schema:");
      const schemaLines = formatSchema(tool.inputSchema);
      if (schemaLines.length === 0) {
        lines.push("  (No input parameters)", "");
      } else {
        lines.push(...schemaLines);
        lines.push("");
      }
    }

    if (tool.outputSchema) {
      lines.push("Output Schema:");
      const schemaLines = formatSchema(tool.outputSchema);
      if (schemaLines.length === 0) {
        lines.push("  (No output schema defined)", "");
      } else {
        lines.push(...schemaLines);
        lines.push("");
      }
    }

    lines.push("Usage Example:");
    lines.push(`  local res = ${luaServerName}.${luaToolName}({`);

    const exampleArgs = this.generateExampleArgs(tool.inputSchema);
    if (exampleArgs.length > 0) {
      lines.push(...exampleArgs.map((arg) => `    ${arg}`));
    } else {
      lines.push("    -- No required parameters");
    }

    lines.push("  }):await(); result(res)");
    lines.push("");

    return lines.join("\n");
  }

  generateExampleArgs(schema: unknown): string[] {
    if (!schema || typeof schema !== "object") {
      return [];
    }

    const schemaObj = schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    if (!schemaObj.properties) {
      return [];
    }

    const required = new Set(schemaObj.required || []);
    const args: string[] = [];

    for (const [fieldName, fieldSchema] of Object.entries(
      schemaObj.properties,
    )) {
      if (required.has(fieldName)) {
        const fieldSchemaObj = fieldSchema as { type?: string };
        const exampleValue = this.getExampleValue(fieldSchemaObj.type);
        args.push(`${fieldName} = ${exampleValue},`);
      }
    }

    return args;
  }

  private getExampleValue(type?: string): string {
    switch (type) {
      case "string":
        return '"example"';
      case "number":
        return "42";
      case "boolean":
        return "true";
      case "array":
        return "{}";
      case "object":
        return "{}";
      default:
        return '"value"';
    }
  }
}

export default MCPFormatterService;
