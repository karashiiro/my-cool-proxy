import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerProxyHandlers } from "./proxy-handlers.js";
import type {
  ILogger,
  IMCPClientManager,
  ISamplingShim,
  ClientCapabilities,
} from "../types/interfaces.js";
import type { MCPGatewayServer } from "../mcp/gateway-server.js";
import type { IMCPClientSession } from "@my-cool-proxy/mcp-aggregation";

// Helper to create proper ClientCapabilities structure
const withSampling: ClientCapabilities = {
  sampling: { context: {}, tools: {} },
};
const withSamplingNoTools: ClientCapabilities = {
  sampling: { context: {} },
};
const withElicitation: ClientCapabilities = { elicitation: { form: {} } };
const withBoth: ClientCapabilities = {
  sampling: { context: {}, tools: {} },
  elicitation: { form: {} },
};
const withNeither: ClientCapabilities = {};

// Mock client session factory
function createMockClientSession(options?: {
  dangerouslyEnableSampling?: boolean;
}): IMCPClientSession {
  return {
    getDangerouslyEnableSampling: vi
      .fn()
      .mockReturnValue(options?.dangerouslyEnableSampling ?? false),
    setRequestHandler: vi.fn(),
    getServerVersion: vi.fn(),
    getInstructions: vi.fn(),
    listTools: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    callTool: vi.fn(),
    readResource: vi.fn(),
    getPrompt: vi.fn(),
    createMessage: vi.fn(),
    elicit: vi.fn(),
    close: vi.fn(),
  } as unknown as IMCPClientSession;
}

// Mock client manager factory
function createMockClientManager(
  clients: Map<string, IMCPClientSession>,
): IMCPClientManager {
  return {
    getClientsBySession: vi.fn().mockReturnValue(clients),
    getFailedServers: vi.fn().mockReturnValue(new Map()),
    connectClient: vi.fn(),
    removeClient: vi.fn(),
    removeSession: vi.fn(),
    closeAll: vi.fn(),
    closeSession: vi.fn(),
    setResourceListChangedHandler: vi.fn(),
    setPromptListChangedHandler: vi.fn(),
    setToolListChangedHandler: vi.fn(),
  } as unknown as IMCPClientManager;
}

// Mock logger factory
function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  } as unknown as ILogger;
}

// Mock gateway server factory
function createMockGatewayServer(): MCPGatewayServer {
  return {
    forwardSamplingRequest: vi.fn().mockResolvedValue({ model: "test" }),
    forwardElicitationRequest: vi.fn().mockResolvedValue({ action: "accept" }),
    getServer: vi.fn(),
    initialize: vi.fn(),
    registerTools: vi.fn(),
    setOnDownstreamInitialized: vi.fn(),
  } as unknown as MCPGatewayServer;
}

// Mock sampling shim factory
function createMockSamplingShim(): ISamplingShim {
  return {
    handleSamplingRequest: vi.fn().mockResolvedValue({ model: "test-shim" }),
    shutdown: vi.fn(),
  } as unknown as ISamplingShim;
}

describe("registerProxyHandlers", () => {
  let logger: ILogger;
  let gatewayServer: MCPGatewayServer;

  beforeEach(() => {
    logger = createMockLogger();
    gatewayServer = createMockGatewayServer();
  });

  describe("sampling handler registration", () => {
    it("should NOT register sampling handler when dangerouslyEnableSampling is false", () => {
      const clientSession = createMockClientSession({
        dangerouslyEnableSampling: false,
      });
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withSampling,
      );

      // setRequestHandler should NOT be called for sampling
      expect(
        (
          clientSession as unknown as {
            setRequestHandler: ReturnType<typeof vi.fn>;
          }
        ).setRequestHandler,
      ).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("NOT registering sampling handler"),
      );
    });

    it("should register sampling handler when dangerouslyEnableSampling is true AND capabilities.sampling is set", () => {
      const clientSession = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withSampling,
      );

      expect(
        (
          clientSession as unknown as {
            setRequestHandler: ReturnType<typeof vi.fn>;
          }
        ).setRequestHandler,
      ).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Registered sampling request handler"),
      );
    });

    it("should NOT register sampling handler when dangerouslyEnableSampling is true but capabilities.sampling is not set and no shim", () => {
      const clientSession = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withNeither,
      );

      expect(
        (
          clientSession as unknown as {
            setRequestHandler: ReturnType<typeof vi.fn>;
          }
        ).setRequestHandler,
      ).not.toHaveBeenCalled();
    });

    it("should use sampling shim when dangerouslyEnableSampling is true but capabilities.sampling is not set", () => {
      const clientSession = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);
      const samplingShim = createMockSamplingShim();

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withNeither,
        samplingShim,
      );

      expect(
        (
          clientSession as unknown as {
            setRequestHandler: ReturnType<typeof vi.fn>;
          }
        ).setRequestHandler,
      ).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Registered sampling shim handler"),
      );
    });

    it("should use sampling shim when client has sampling but lacks tools support", () => {
      const clientSession = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);
      const samplingShim = createMockSamplingShim();

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withSamplingNoTools,
        samplingShim,
      );

      expect(
        (
          clientSession as unknown as {
            setRequestHandler: ReturnType<typeof vi.fn>;
          }
        ).setRequestHandler,
      ).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Registered sampling shim handler"),
      );
    });

    it("should prefer shim over native when both are available", () => {
      const clientSession = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);
      const samplingShim = createMockSamplingShim();

      // Client has full sampling capability AND shim is provided
      // This simulates when index.ts determines shim is superior despite client having sampling
      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withSampling,
        samplingShim,
      );

      expect(
        (
          clientSession as unknown as {
            setRequestHandler: ReturnType<typeof vi.fn>;
          }
        ).setRequestHandler,
      ).toHaveBeenCalledTimes(1);
      // Shim should take priority over native
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Registered sampling shim handler"),
      );
    });
  });

  describe("elicitation handler registration", () => {
    it("should register elicitation handler when capabilities.elicitation is set", () => {
      const clientSession = createMockClientSession();
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withElicitation,
      );

      expect(
        (
          clientSession as unknown as {
            setRequestHandler: ReturnType<typeof vi.fn>;
          }
        ).setRequestHandler,
      ).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Registered elicitation request handler"),
      );
    });

    it("should NOT register elicitation handler when capabilities.elicitation is not set", () => {
      const clientSession = createMockClientSession();
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withNeither,
      );

      expect(
        (
          clientSession as unknown as {
            setRequestHandler: ReturnType<typeof vi.fn>;
          }
        ).setRequestHandler,
      ).not.toHaveBeenCalled();
    });
  });

  describe("multiple clients", () => {
    it("should register handlers for all clients in session", () => {
      const client1 = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const client2 = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const client3 = createMockClientSession({
        dangerouslyEnableSampling: false,
      });
      const clients = new Map([
        ["server1", client1],
        ["server2", client2],
        ["server3", client3],
      ]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withBoth,
      );

      // client1 and client2: sampling + elicitation
      expect(
        (client1 as unknown as { setRequestHandler: ReturnType<typeof vi.fn> })
          .setRequestHandler,
      ).toHaveBeenCalledTimes(2);
      expect(
        (client2 as unknown as { setRequestHandler: ReturnType<typeof vi.fn> })
          .setRequestHandler,
      ).toHaveBeenCalledTimes(2);
      // client3: only elicitation (sampling disabled)
      expect(
        (client3 as unknown as { setRequestHandler: ReturnType<typeof vi.fn> })
          .setRequestHandler,
      ).toHaveBeenCalledTimes(1);
    });

    it("should call getClientsBySession with correct session ID", () => {
      const clients = new Map<string, IMCPClientSession>();
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "my-special-session",
        clientManager,
        gatewayServer,
        logger,
        withNeither,
      );

      expect(clientManager.getClientsBySession).toHaveBeenCalledWith(
        "my-special-session",
      );
    });
  });

  describe("handler execution", () => {
    it("should forward sampling request to gateway server", async () => {
      const clientSession = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withSampling,
      );

      // Get the registered handler
      const mockSetHandler = (
        clientSession as unknown as {
          setRequestHandler: ReturnType<typeof vi.fn>;
        }
      ).setRequestHandler;
      const handler = mockSetHandler.mock.calls[0]?.[1];

      // Call the handler
      const result = await handler({
        params: { messages: [], maxTokens: 100 },
      });

      expect(gatewayServer.forwardSamplingRequest).toHaveBeenCalledWith({
        messages: [],
        maxTokens: 100,
      });
      expect(result).toEqual({ model: "test" });
    });

    it("should forward elicitation request to gateway server", async () => {
      const clientSession = createMockClientSession();
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withElicitation,
      );

      // Get the registered handler
      const mockSetHandler = (
        clientSession as unknown as {
          setRequestHandler: ReturnType<typeof vi.fn>;
        }
      ).setRequestHandler;
      const handler = mockSetHandler.mock.calls[0]?.[1];

      // Call the handler
      const result = await handler({
        params: { message: "test", schema: {} },
      });

      expect(gatewayServer.forwardElicitationRequest).toHaveBeenCalledWith({
        message: "test",
        schema: {},
      });
      expect(result).toEqual({ action: "accept" });
    });

    it("should log and rethrow errors from sampling handler", async () => {
      const clientSession = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);
      const testError = new Error("Sampling failed");
      (
        gatewayServer.forwardSamplingRequest as ReturnType<typeof vi.fn>
      ).mockRejectedValue(testError);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withSampling,
      );

      const mockSetHandler = (
        clientSession as unknown as {
          setRequestHandler: ReturnType<typeof vi.fn>;
        }
      ).setRequestHandler;
      const handler = mockSetHandler.mock.calls[0]?.[1];

      await expect(handler({ params: {} })).rejects.toThrow("Sampling failed");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to forward sampling request"),
        expect.any(Error),
      );
    });

    it("should route sampling through shim when configured", async () => {
      const clientSession = createMockClientSession({
        dangerouslyEnableSampling: true,
      });
      const clients = new Map([["test-server", clientSession]]);
      const clientManager = createMockClientManager(clients);
      const samplingShim = createMockSamplingShim();

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withNeither,
        samplingShim,
      );

      const mockSetHandler = (
        clientSession as unknown as {
          setRequestHandler: ReturnType<typeof vi.fn>;
        }
      ).setRequestHandler;
      const handler = mockSetHandler.mock.calls[0]?.[1];

      const result = await handler({
        params: { messages: [], maxTokens: 50 },
      });

      expect(samplingShim.handleSamplingRequest).toHaveBeenCalledWith(
        "test-session",
        { messages: [], maxTokens: 50 },
      );
      expect(result).toEqual({ model: "test-shim" });
    });
  });

  describe("logging", () => {
    it("should log info message with capability summary when any capability enabled", () => {
      const clients = new Map([["test-server", createMockClientSession()]]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withSampling,
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(
          /Registered proxy handlers.*sampling=true.*elicitation=false/,
        ),
      );
    });

    it("should NOT log info message when no capabilities enabled", () => {
      const clients = new Map([["test-server", createMockClientSession()]]);
      const clientManager = createMockClientManager(clients);

      registerProxyHandlers(
        "test-session",
        clientManager,
        gatewayServer,
        logger,
        withNeither,
      );

      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
