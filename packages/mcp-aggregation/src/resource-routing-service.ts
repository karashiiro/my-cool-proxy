import type { ILogger } from "./types.js";

/**
 * Interface for the resource routing service that maps resource URIs
 * to their source MCP servers without mutating the URIs themselves.
 *
 * This replaces the previous `gw://` URI namespacing approach, which was
 * fragile because URI parsers in clients (e.g. VS Code) normalize paths
 * and destroy embedded URIs.
 */
export interface IResourceRoutingService {
  /**
   * Register a resource URI from a `listResources()` result.
   * These registrations are cleared on session invalidation.
   */
  registerUri: (sessionId: string, uri: string, serverName: string) => void;

  /**
   * Register a resource template URI from a `listResourceTemplates()` result.
   * These registrations are cleared on session invalidation.
   */
  registerTemplate: (
    sessionId: string,
    uriTemplate: string,
    serverName: string,
  ) => void;

  /**
   * Register a resource URI encountered in tool results or prompt results.
   * These registrations persist across session invalidation because they
   * remain valid references even when the resource list changes.
   */
  registerEncounteredUri: (
    sessionId: string,
    uri: string,
    serverName: string,
  ) => void;

  /**
   * Look up which server owns a given resource URI.
   *
   * Resolution order:
   * 1. Exact match in URI map (from listResources)
   * 2. Exact match in encountered URI map (from tool/prompt results)
   * 3. Longest template prefix match (from listResourceTemplates)
   *
   * @returns The server name, or undefined if no route is found
   */
  getServerForUri: (sessionId: string, uri: string) => string | undefined;

  /**
   * Clear listing-derived routes (URI map + template map) for a session.
   * Called when a server reports `resources/list_changed`.
   * Encounter-based registrations are preserved.
   */
  invalidateSession: (sessionId: string) => void;

  /**
   * Fully remove all routing data for a session (URI map, templates, encounters).
   * Called when an HTTP session is closed to prevent memory leaks.
   */
  deleteSession: (sessionId: string) => void;
}

interface TemplateEntry {
  uriTemplate: string;
  prefix: string;
  serverName: string;
}

interface SessionRoutes {
  /** URI → serverName (from listResources) */
  uriMap: Map<string, string>;
  /** Template entries with extracted prefixes (from listResourceTemplates) */
  templates: TemplateEntry[];
  /** URI → serverName (from tool/prompt results — survives invalidation) */
  encounteredMap: Map<string, string>;
}

/**
 * Extract the static prefix from a URI template (everything before the first `{`).
 *
 * @example
 * extractTemplatePrefix("deployment://{region}/{service}")
 * // Returns: "deployment://"
 *
 * @example
 * extractTemplatePrefix("file:///docs/{path}")
 * // Returns: "file:///docs/"
 *
 * @example
 * extractTemplatePrefix("no-vars-here")
 * // Returns: "no-vars-here"
 */
export function extractTemplatePrefix(uriTemplate: string): string {
  const braceIndex = uriTemplate.indexOf("{");
  if (braceIndex === -1) {
    return uriTemplate;
  }
  return uriTemplate.slice(0, braceIndex);
}

export class ResourceRoutingService implements IResourceRoutingService {
  private sessions = new Map<string, SessionRoutes>();

  constructor(private logger: ILogger) {}

  private getOrCreateSession(sessionId: string): SessionRoutes {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        uriMap: new Map(),
        templates: [],
        encounteredMap: new Map(),
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  registerUri(sessionId: string, uri: string, serverName: string): void {
    const session = this.getOrCreateSession(sessionId);
    const existing = session.uriMap.get(uri);
    if (existing && existing !== serverName) {
      this.logger.warn(
        `Resource URI collision: '${uri}' registered by both '${existing}' and '${serverName}' (session: ${sessionId}). Using '${serverName}'.`,
      );
    }
    session.uriMap.set(uri, serverName);
  }

  registerTemplate(
    sessionId: string,
    uriTemplate: string,
    serverName: string,
  ): void {
    const session = this.getOrCreateSession(sessionId);
    const prefix = extractTemplatePrefix(uriTemplate);

    // Guard: empty prefix would match every URI — skip with a warning
    if (prefix === "") {
      this.logger.warn(
        `Skipping resource template '${uriTemplate}' with empty prefix ` +
          `(session: ${sessionId}, server: '${serverName}'). ` +
          `Templates starting with a variable cannot be routed by prefix.`,
      );
      return;
    }

    // Check for existing entry with the same template
    const existing = session.templates.find(
      (t) => t.uriTemplate === uriTemplate,
    );
    if (existing) {
      if (existing.serverName !== serverName) {
        // Collision: different server for same template
        this.logger.warn(
          `Resource template collision: '${uriTemplate}' registered by both '${existing.serverName}' and '${serverName}' (session: ${sessionId}). Using '${serverName}'.`,
        );
        existing.serverName = serverName;
        existing.prefix = prefix;
      }
      // Same server re-registering the same template — no-op
      return;
    }

    session.templates.push({ uriTemplate, prefix, serverName });
  }

  registerEncounteredUri(
    sessionId: string,
    uri: string,
    serverName: string,
  ): void {
    const session = this.getOrCreateSession(sessionId);

    // Skip if this URI is already tracked via listings (uriMap).
    // Listing-derived URIs should be cleared on invalidation,
    // so we don't want them to persist in the encountered map.
    if (session.uriMap.has(uri)) {
      return;
    }

    session.encounteredMap.set(uri, serverName);
  }

  getServerForUri(sessionId: string, uri: string): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // 1. Exact match in URI map (from listResources)
    const exactMatch = session.uriMap.get(uri);
    if (exactMatch) return exactMatch;

    // 2. Exact match in encountered map (from tool/prompt results)
    const encounteredMatch = session.encounteredMap.get(uri);
    if (encounteredMatch) return encounteredMatch;

    // 3. Longest template prefix match
    let bestMatch: TemplateEntry | undefined;
    for (const entry of session.templates) {
      if (
        uri.startsWith(entry.prefix) &&
        (!bestMatch || entry.prefix.length > bestMatch.prefix.length)
      ) {
        bestMatch = entry;
      }
    }

    return bestMatch?.serverName;
  }

  invalidateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.logger.debug(
      `Invalidating listing-derived routes for session '${sessionId}' ` +
        `(${session.uriMap.size} URIs, ${session.templates.length} templates cleared; ` +
        `${session.encounteredMap.size} encountered URIs preserved)`,
    );

    session.uriMap.clear();
    session.templates = [];
    // encounteredMap is preserved intentionally
  }

  deleteSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.logger.debug(
      `Deleting all routes for session '${sessionId}' ` +
        `(${session.uriMap.size} URIs, ${session.templates.length} templates, ` +
        `${session.encounteredMap.size} encountered URIs removed)`,
    );

    this.sessions.delete(sessionId);
  }
}
