import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ResourceRoutingService,
  extractTemplatePrefix,
} from "./resource-routing-service.js";
import type { ILogger } from "./types.js";

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  };
}

describe("extractTemplatePrefix", () => {
  it("should extract prefix before first template variable", () => {
    expect(extractTemplatePrefix("deployment://{region}/{service}")).toBe(
      "deployment://",
    );
  });

  it("should extract prefix with path before variable", () => {
    expect(extractTemplatePrefix("file:///docs/{path}")).toBe("file:///docs/");
  });

  it("should return full string when no variables present", () => {
    expect(extractTemplatePrefix("no-vars-here")).toBe("no-vars-here");
  });

  it("should return empty prefix when variable is at start", () => {
    expect(extractTemplatePrefix("{scheme}://rest")).toBe("");
  });

  it("should handle URI with complex scheme", () => {
    expect(extractTemplatePrefix("custom+scheme://host/{path}")).toBe(
      "custom+scheme://host/",
    );
  });
});

describe("ResourceRoutingService", () => {
  let service: ResourceRoutingService;
  let logger: ILogger;

  beforeEach(() => {
    logger = createMockLogger();
    service = new ResourceRoutingService(logger);
  });

  describe("registerUri / getServerForUri (exact match)", () => {
    it("should resolve a registered URI to its server", () => {
      service.registerUri("s1", "file:///docs/README.md", "docs-server");
      expect(service.getServerForUri("s1", "file:///docs/README.md")).toBe(
        "docs-server",
      );
    });

    it("should return undefined for unknown URIs", () => {
      expect(service.getServerForUri("s1", "file:///unknown")).toBeUndefined();
    });

    it("should return undefined for unknown sessions", () => {
      service.registerUri("s1", "file:///doc.md", "server");
      expect(service.getServerForUri("s2", "file:///doc.md")).toBeUndefined();
    });

    it("should handle multiple URIs from different servers", () => {
      service.registerUri("s1", "file:///a.md", "server-a");
      service.registerUri("s1", "file:///b.md", "server-b");
      expect(service.getServerForUri("s1", "file:///a.md")).toBe("server-a");
      expect(service.getServerForUri("s1", "file:///b.md")).toBe("server-b");
    });
  });

  describe("collision handling", () => {
    it("should warn on URI collision and use last-registered server", () => {
      service.registerUri("s1", "file:///data.json", "server-a");
      service.registerUri("s1", "file:///data.json", "server-b");

      expect(service.getServerForUri("s1", "file:///data.json")).toBe(
        "server-b",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("collision"),
      );
    });

    it("should not warn when re-registering same server for same URI", () => {
      service.registerUri("s1", "file:///data.json", "server-a");
      service.registerUri("s1", "file:///data.json", "server-a");

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should not duplicate template on same-server re-registration", () => {
      service.registerTemplate(
        "s1",
        "deployment://{region}/{service}",
        "server-a",
      );
      // Re-register same template from same server (e.g., after cache invalidation + re-list)
      service.registerTemplate(
        "s1",
        "deployment://{region}/{service}",
        "server-a",
      );

      // Should still resolve correctly (not duplicated)
      expect(service.getServerForUri("s1", "deployment://us-east-1/api")).toBe(
        "server-a",
      );
      // No collision warning
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should skip templates with empty prefix and warn", () => {
      service.registerTemplate("s1", "{scheme}://rest/{path}", "server-a");

      // Should not match anything — the template was skipped
      expect(service.getServerForUri("s1", "http://rest/foo")).toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("empty prefix"),
      );
    });

    it("should warn on template collision and update server", () => {
      service.registerTemplate(
        "s1",
        "deployment://{region}/{service}",
        "server-a",
      );
      service.registerTemplate(
        "s1",
        "deployment://{region}/{service}",
        "server-b",
      );

      expect(service.getServerForUri("s1", "deployment://us-east-1/api")).toBe(
        "server-b",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("template collision"),
      );
    });
  });

  describe("same scheme, different paths across servers", () => {
    it("should independently route file:// URIs with different paths", () => {
      service.registerUri("s1", "file:///config.json", "config-server");
      service.registerUri("s1", "file:///data.json", "data-server");
      service.registerUri("s1", "file:///logs/app.log", "log-server");

      expect(service.getServerForUri("s1", "file:///config.json")).toBe(
        "config-server",
      );
      expect(service.getServerForUri("s1", "file:///data.json")).toBe(
        "data-server",
      );
      expect(service.getServerForUri("s1", "file:///logs/app.log")).toBe(
        "log-server",
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should handle mixed schemes from multiple servers without collision", () => {
      service.registerUri("s1", "file:///readme.md", "docs-server");
      service.registerUri("s1", "file:///schema.sql", "db-server");
      service.registerUri("s1", "https://api.example.com/spec", "api-server");

      expect(service.getServerForUri("s1", "file:///readme.md")).toBe(
        "docs-server",
      );
      expect(service.getServerForUri("s1", "file:///schema.sql")).toBe(
        "db-server",
      );
      expect(
        service.getServerForUri("s1", "https://api.example.com/spec"),
      ).toBe("api-server");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should warn only for exact URI collisions, not same-scheme different-path", () => {
      // These share file:// scheme but different paths — no collision
      service.registerUri("s1", "file:///a.txt", "server-a");
      service.registerUri("s1", "file:///b.txt", "server-b");
      expect(logger.warn).not.toHaveBeenCalled();

      // This IS a collision — same exact URI from a different server
      service.registerUri("s1", "file:///a.txt", "server-c");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("collision"),
      );
    });
  });

  describe("mixed colliding and non-colliding URIs", () => {
    it("should route non-colliding URIs correctly even when some collide", () => {
      // server-a: unique + shared
      service.registerUri("s1", "file:///only-a.json", "server-a");
      service.registerUri("s1", "file:///shared.json", "server-a");

      // server-b: unique + shared (overwrites server-a for shared)
      service.registerUri("s1", "file:///only-b.json", "server-b");
      service.registerUri("s1", "file:///shared.json", "server-b");

      // Unique URIs route to their respective servers
      expect(service.getServerForUri("s1", "file:///only-a.json")).toBe(
        "server-a",
      );
      expect(service.getServerForUri("s1", "file:///only-b.json")).toBe(
        "server-b",
      );

      // Colliding URI routes to last-registered (server-b)
      expect(service.getServerForUri("s1", "file:///shared.json")).toBe(
        "server-b",
      );

      // Only one collision warning (for the shared URI)
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("should handle three-way URI collision", () => {
      service.registerUri("s1", "file:///config.json", "server-a");
      service.registerUri("s1", "file:///config.json", "server-b");
      service.registerUri("s1", "file:///config.json", "server-c");

      // Last one wins
      expect(service.getServerForUri("s1", "file:///config.json")).toBe(
        "server-c",
      );
      // Two collision warnings (b overwrites a, c overwrites b)
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe("template prefix overlap across servers", () => {
    it("should route to more specific template when prefixes overlap", () => {
      // server-a owns docs subtree
      service.registerTemplate("s1", "file:///docs/{path}", "docs-server");
      // server-b owns the broader file tree
      service.registerTemplate("s1", "file:///{path}", "file-server");

      // Docs path → docs-server (longer prefix "file:///docs/")
      expect(service.getServerForUri("s1", "file:///docs/api.md")).toBe(
        "docs-server",
      );
      // Non-docs path → file-server (shorter prefix "file:///")
      expect(service.getServerForUri("s1", "file:///src/main.ts")).toBe(
        "file-server",
      );
      // No collision warning (different templates)
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should handle exact template collision (same template, different servers)", () => {
      service.registerTemplate("s1", "file:///{path}", "server-a");
      service.registerTemplate("s1", "file:///{path}", "server-b");

      // Last registered wins
      expect(service.getServerForUri("s1", "file:///anything.txt")).toBe(
        "server-b",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("template collision"),
      );
    });

    it("should prefer exact URI match over template even when template is more specific", () => {
      // Template covers file:///docs/ subtree
      service.registerTemplate("s1", "file:///docs/{path}", "template-server");
      // Exact URI registration for a specific file in that subtree
      service.registerUri("s1", "file:///docs/special.md", "exact-server");

      // Exact match wins over template prefix match
      expect(service.getServerForUri("s1", "file:///docs/special.md")).toBe(
        "exact-server",
      );
      // Other docs paths still route via template
      expect(service.getServerForUri("s1", "file:///docs/other.md")).toBe(
        "template-server",
      );
    });
  });

  describe("registerTemplate / getServerForUri (prefix match)", () => {
    it("should match URI by template prefix", () => {
      service.registerTemplate(
        "s1",
        "deployment://{region}/{service}",
        "deploy-server",
      );

      expect(
        service.getServerForUri("s1", "deployment://us-east-1/api-gateway"),
      ).toBe("deploy-server");
    });

    it("should prefer longest prefix match", () => {
      service.registerTemplate("s1", "file:///docs/{path}", "docs-server");
      service.registerTemplate("s1", "file:///{path}", "generic-file-server");

      // Should match docs-server because "file:///docs/" is a longer prefix
      expect(service.getServerForUri("s1", "file:///docs/README.md")).toBe(
        "docs-server",
      );

      // Should match generic server for non-docs paths
      expect(service.getServerForUri("s1", "file:///other/thing.txt")).toBe(
        "generic-file-server",
      );
    });

    it("should not match if URI does not start with prefix", () => {
      service.registerTemplate(
        "s1",
        "deployment://{region}/{service}",
        "deploy-server",
      );

      expect(
        service.getServerForUri("s1", "file:///something"),
      ).toBeUndefined();
    });
  });

  describe("registerEncounteredUri", () => {
    it("should resolve encountered URIs", () => {
      service.registerEncounteredUri(
        "s1",
        "custom://data/result.json",
        "data-server",
      );

      expect(service.getServerForUri("s1", "custom://data/result.json")).toBe(
        "data-server",
      );
    });

    it("should prefer exact URI match over encountered match", () => {
      service.registerUri("s1", "file:///doc.md", "listing-server");
      service.registerEncounteredUri("s1", "file:///doc.md", "tool-server");

      // URI map (from listResources) should win
      expect(service.getServerForUri("s1", "file:///doc.md")).toBe(
        "listing-server",
      );
    });

    it("should skip encounter registration for URIs already in uriMap", () => {
      // URI is known from listings
      service.registerUri("s1", "file:///doc.md", "listing-server");

      // readResource encounters the same URI — should be skipped
      service.registerEncounteredUri("s1", "file:///doc.md", "listing-server");

      // After invalidation, the URI should NOT survive via encountered map
      service.invalidateSession("s1");
      expect(service.getServerForUri("s1", "file:///doc.md")).toBeUndefined();
    });

    it("should drop cross-server encounter for listed URI — URI unroutable after invalidation", () => {
      // Server A lists URI via listResources
      service.registerUri("s1", "file:///doc.md", "server-a");

      // Server B encounters same URI in a tool result — encounter is
      // silently dropped because the URI is already in uriMap
      service.registerEncounteredUri("s1", "file:///doc.md", "server-b");

      // Before invalidation, the URI routes to server-a (from listing)
      expect(service.getServerForUri("s1", "file:///doc.md")).toBe("server-a");

      // After invalidation, the listing-derived entry is cleared and
      // the encounter was never stored, so the URI becomes unroutable.
      // This is a known trade-off: cross-server encounters for listed URIs
      // are dropped to prevent listing-derived URIs from surviving invalidation.
      service.invalidateSession("s1");
      expect(service.getServerForUri("s1", "file:///doc.md")).toBeUndefined();
    });

    it("should prefer encountered match over template prefix match", () => {
      service.registerTemplate("s1", "file:///{path}", "template-server");
      service.registerEncounteredUri(
        "s1",
        "file:///specific.md",
        "encountered-server",
      );

      expect(service.getServerForUri("s1", "file:///specific.md")).toBe(
        "encountered-server",
      );

      // Other URIs should still match via template
      expect(service.getServerForUri("s1", "file:///other.md")).toBe(
        "template-server",
      );
    });
  });

  describe("session isolation", () => {
    it("should not leak routes between sessions", () => {
      service.registerUri("s1", "file:///a.md", "server-a");
      service.registerUri("s2", "file:///b.md", "server-b");

      expect(service.getServerForUri("s1", "file:///b.md")).toBeUndefined();
      expect(service.getServerForUri("s2", "file:///a.md")).toBeUndefined();
    });
  });

  describe("invalidateSession", () => {
    it("should clear URI map and templates but preserve encounters", () => {
      service.registerUri("s1", "file:///listed.md", "list-server");
      service.registerTemplate("s1", "deploy://{region}", "deploy-server");
      service.registerEncounteredUri(
        "s1",
        "file:///from-tool.md",
        "tool-server",
      );

      service.invalidateSession("s1");

      // Listing-derived routes should be gone
      expect(
        service.getServerForUri("s1", "file:///listed.md"),
      ).toBeUndefined();
      expect(
        service.getServerForUri("s1", "deploy://us-east-1"),
      ).toBeUndefined();

      // Encountered routes should persist
      expect(service.getServerForUri("s1", "file:///from-tool.md")).toBe(
        "tool-server",
      );
    });

    it("should be a no-op for unknown sessions", () => {
      // Should not throw
      service.invalidateSession("nonexistent");
    });

    it("should log invalidation details", () => {
      service.registerUri("s1", "file:///a.md", "server");
      service.registerTemplate("s1", "file:///{path}", "server");
      service.registerEncounteredUri("s1", "file:///b.md", "server");

      service.invalidateSession("s1");

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("1 URIs"),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("1 templates cleared"),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("1 encountered URIs preserved"),
      );
    });
  });

  describe("deleteSession", () => {
    it("should remove all routing data for a session", () => {
      service.registerUri("s1", "file:///listed.md", "list-server");
      service.registerTemplate("s1", "deploy://{region}", "deploy-server");
      service.registerEncounteredUri(
        "s1",
        "file:///from-tool.md",
        "tool-server",
      );

      service.deleteSession("s1");

      // Everything should be gone — including encounters
      expect(
        service.getServerForUri("s1", "file:///listed.md"),
      ).toBeUndefined();
      expect(
        service.getServerForUri("s1", "deploy://us-east-1"),
      ).toBeUndefined();
      expect(
        service.getServerForUri("s1", "file:///from-tool.md"),
      ).toBeUndefined();
    });

    it("should not affect other sessions", () => {
      service.registerUri("s1", "file:///a.md", "server-a");
      service.registerUri("s2", "file:///b.md", "server-b");

      service.deleteSession("s1");

      expect(service.getServerForUri("s1", "file:///a.md")).toBeUndefined();
      expect(service.getServerForUri("s2", "file:///b.md")).toBe("server-b");
    });

    it("should be a no-op for unknown sessions", () => {
      // Should not throw
      service.deleteSession("nonexistent");
    });

    it("should log deletion details", () => {
      service.registerUri("s1", "file:///a.md", "server");
      service.registerTemplate("s1", "file:///{path}", "server");
      service.registerEncounteredUri("s1", "file:///b.md", "server");

      service.deleteSession("s1");

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Deleting all routes"),
      );
    });
  });

  describe("resolution priority", () => {
    it("should resolve in correct priority: URI > encountered > template", () => {
      // Register all three types for the same URI
      service.registerTemplate("s1", "file:///{path}", "template-server");
      service.registerEncounteredUri(
        "s1",
        "file:///doc.md",
        "encountered-server",
      );
      service.registerUri("s1", "file:///doc.md", "uri-server");

      // URI map should win
      expect(service.getServerForUri("s1", "file:///doc.md")).toBe(
        "uri-server",
      );

      // After invalidation, encountered should win
      service.invalidateSession("s1");
      expect(service.getServerForUri("s1", "file:///doc.md")).toBe(
        "encountered-server",
      );
    });
  });
});
