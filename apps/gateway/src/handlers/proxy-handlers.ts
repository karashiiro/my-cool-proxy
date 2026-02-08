import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ILogger,
  IMCPClientManager,
  ISamplingPonyfill,
  ClientCapabilities,
} from "../types/interfaces.js";
import type { MCPGatewayServer } from "../mcp/gateway-server.js";

/**
 * Register sampling and elicitation request handlers on upstream clients.
 * These handlers forward requests from upstream servers to the downstream client
 * via the gateway server.
 */
export function registerProxyHandlers(
  sessionId: string,
  clientManager: IMCPClientManager,
  gatewayServer: MCPGatewayServer,
  logger: ILogger,
  capabilities: ClientCapabilities,
  samplingPonyfill?: ISamplingPonyfill,
): void {
  const clients = clientManager.getClientsBySession(sessionId);

  for (const [serverName, clientSession] of clients) {
    // SECURITY: Only register sampling handlers for trusted servers
    // This is the second line of defense (after capability filtering)
    const samplingEnabled = clientSession.getDangerouslyEnableSampling();

    // Register sampling handler ONLY if server is trusted
    if (samplingEnabled && capabilities.sampling) {
      clientSession.setRequestHandler(
        CreateMessageRequestSchema,
        async (request) => {
          logger.debug(
            `Received sampling request from upstream server '${serverName}', forwarding to downstream`,
          );
          try {
            const result = await gatewayServer.forwardSamplingRequest(
              request.params,
            );
            return result;
          } catch (error) {
            logger.error(
              `Failed to forward sampling request from '${serverName}'`,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          }
        },
      );
      logger.debug(
        `Registered sampling request handler for upstream server '${serverName}'`,
      );
    } else if (samplingEnabled && samplingPonyfill) {
      // Sampling ponyfill: route through ACP agent when client lacks native sampling
      clientSession.setRequestHandler(
        CreateMessageRequestSchema,
        async (request) => {
          logger.debug(
            `Received sampling request from upstream server '${serverName}', routing through ACP ponyfill`,
          );
          try {
            const result = await samplingPonyfill.handleSamplingRequest(
              sessionId,
              request.params,
            );
            return result;
          } catch (error) {
            logger.error(
              `Failed to handle sampling request via ponyfill from '${serverName}'`,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          }
        },
      );
      logger.debug(
        `Registered sampling ponyfill handler for upstream server '${serverName}'`,
      );
    } else if (
      !samplingEnabled &&
      (capabilities.sampling || samplingPonyfill)
    ) {
      logger.debug(
        `NOT registering sampling handler for server '${serverName}' - dangerouslyEnableSampling not enabled`,
      );
    }

    // Register elicitation handler if downstream supports it
    if (capabilities.elicitation) {
      clientSession.setRequestHandler(ElicitRequestSchema, async (request) => {
        logger.debug(
          `Received elicitation request from upstream server '${serverName}', forwarding to downstream`,
        );
        try {
          const result = await gatewayServer.forwardElicitationRequest(
            request.params,
          );
          return result;
        } catch (error) {
          logger.error(
            `Failed to forward elicitation request from '${serverName}'`,
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      });
      logger.debug(
        `Registered elicitation request handler for upstream server '${serverName}'`,
      );
    }
  }

  const clientCount = clients.size;
  if (capabilities.sampling || samplingPonyfill || capabilities.elicitation) {
    logger.info(
      `Registered proxy handlers on ${clientCount} upstream client(s): ` +
        `sampling=${!!capabilities.sampling}, samplingPonyfill=${!!samplingPonyfill}, elicitation=${!!capabilities.elicitation}`,
    );
  }
}
