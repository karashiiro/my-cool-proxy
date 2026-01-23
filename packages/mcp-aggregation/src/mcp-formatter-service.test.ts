import { describe, it, expect } from "vitest";
import { MCPFormatterService } from "./mcp-formatter-service.js";
import type { ServerListItem, ToolInfo } from "./types.js";

describe("MCPFormatterService", () => {
  const formatter = new MCPFormatterService();

  describe("formatServerList", () => {
    it("should format empty server list", () => {
      const result = formatter.formatServerList("session-123", []);

      expect(result).toContain("Available MCP Servers: 0");
      expect(result).toContain("No servers available");
    });

    it("should format server list with servers", () => {
      const servers: ServerListItem[] = [
        {
          luaIdentifier: "my_server",
          serverInfo: {
            name: "My Server",
            version: "1.0.0",
            description: "A test server",
          },
        },
      ];

      const result = formatter.formatServerList("session-123", servers);

      expect(result).toContain("my_server");
      expect(result).toContain("My Server");
      expect(result).toContain("1.0.0");
      expect(result).toContain("A test server");
    });

    it("should format failed servers with error", () => {
      const servers: ServerListItem[] = [
        {
          luaIdentifier: "failed_server",
          error: "Connection failed",
        },
      ];

      const result = formatter.formatServerList("session-123", servers);

      expect(result).toContain("failed_server");
      expect(result).toContain("Connection failed");
    });
  });

  describe("formatToolList", () => {
    it("should format empty tool list", () => {
      const result = formatter.formatToolList("my_server", []);

      expect(result).toContain("Available Tools: 0");
      expect(result).toContain("No tools available");
    });

    it("should format tool list with tools", () => {
      const tools: ToolInfo[] = [
        { luaName: "get_data", description: "Gets some data" },
        { luaName: "set_data", description: "Sets some data" },
      ];

      const result = formatter.formatToolList("my_server", tools);

      expect(result).toContain("Available Tools: 2");
      expect(result).toContain("get_data");
      expect(result).toContain("Gets some data");
      expect(result).toContain("set_data");
    });

    it("should truncate long descriptions", () => {
      const longDescription = "A".repeat(150);
      const tools: ToolInfo[] = [
        { luaName: "tool", description: longDescription },
      ];

      const result = formatter.formatToolList("server", tools);

      expect(result).toContain("...");
      expect(result).not.toContain(longDescription);
    });
  });

  describe("formatToolDetails", () => {
    it("should format tool with description", () => {
      const tool = {
        name: "my-tool",
        description: "A useful tool",
        inputSchema: { type: "object", properties: {} },
      };

      const result = formatter.formatToolDetails("server", "my_tool", tool);

      expect(result).toContain("Server: server");
      expect(result).toContain("Tool: my_tool");
      expect(result).toContain("A useful tool");
    });

    it("should generate usage example", () => {
      const tool = {
        name: "calc",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["x", "y"],
        },
      };

      const result = formatter.formatToolDetails("math", "calc", tool);

      expect(result).toContain("Usage Example:");
      expect(result).toContain("math.calc");
      expect(result).toContain("x = 42");
      expect(result).toContain("y = 42");
    });
  });

  describe("generateExampleArgs", () => {
    it("should return empty array for null schema", () => {
      const result = formatter.generateExampleArgs(null);
      expect(result).toEqual([]);
    });

    it("should return empty array for schema without properties", () => {
      const result = formatter.generateExampleArgs({ type: "object" });
      expect(result).toEqual([]);
    });

    it("should generate example for string type", () => {
      const schema = {
        properties: { name: { type: "string" } },
        required: ["name"],
      };

      const result = formatter.generateExampleArgs(schema);
      expect(result).toContain('name = "example",');
    });

    it("should generate example for number type", () => {
      const schema = {
        properties: { count: { type: "number" } },
        required: ["count"],
      };

      const result = formatter.generateExampleArgs(schema);
      expect(result).toContain("count = 42,");
    });

    it("should generate example for boolean type", () => {
      const schema = {
        properties: { enabled: { type: "boolean" } },
        required: ["enabled"],
      };

      const result = formatter.generateExampleArgs(schema);
      expect(result).toContain("enabled = true,");
    });

    it("should only include required fields", () => {
      const schema = {
        properties: {
          required_field: { type: "string" },
          optional_field: { type: "string" },
        },
        required: ["required_field"],
      };

      const result = formatter.generateExampleArgs(schema);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("required_field");
    });
  });
});
