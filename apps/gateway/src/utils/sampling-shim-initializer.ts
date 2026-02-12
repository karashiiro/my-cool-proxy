import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

import type { ILogger, ISamplingShim } from "../types/interfaces.js";

/**
 * Result of sampling shim initialization.
 */
export interface SamplingShimInitResult {
  /** The active shim instance if initialized, undefined otherwise */
  activeShim: ISamplingShim | undefined;
  /** Client capabilities, possibly augmented with sampling.tools if shim is active */
  upstreamCapabilities: ClientCapabilities;
}

/**
 * Initialize the sampling shim for a session if needed.
 *
 * This function determines whether the sampling shim should be installed based on
 * the client's capabilities and initializes it if necessary. The shim provides
 * enhanced sampling with tools support via the ACP agent sidecar.
 *
 * Installation criteria:
 * - Shim is configured (samplingShim is not undefined)
 * - Client lacks sampling support entirely, OR
 * - Client has sampling but lacks tools support
 *
 * When the shim is installed, the returned capabilities are augmented with
 * `sampling.tools: {}` so upstream servers see full sampling support.
 *
 * @param sessionId - The session ID for logging and initialization
 * @param clientCapabilities - The downstream client's advertised capabilities
 * @param samplingShim - The sampling shim instance, or undefined if not configured
 * @param logger - Logger for info/error messages
 * @returns The active shim (if any) and the (possibly augmented) upstream capabilities
 */
export async function initializeSamplingShim(
  sessionId: string,
  clientCapabilities: ClientCapabilities,
  samplingShim: ISamplingShim | undefined,
  logger: ILogger,
): Promise<SamplingShimInitResult> {
  // Return early if no shim configured
  if (!samplingShim) {
    return {
      activeShim: undefined,
      upstreamCapabilities: clientCapabilities,
    };
  }

  // Detect client capabilities
  const clientHasSampling = !!clientCapabilities.sampling;
  const clientHasSamplingTools = !!clientCapabilities.sampling?.tools;
  const shimShouldInstall = !clientHasSampling || !clientHasSamplingTools;

  // Return early if client has full capability
  if (!shimShouldInstall) {
    return {
      activeShim: undefined,
      upstreamCapabilities: clientCapabilities,
    };
  }

  // Initialize shim
  try {
    const reason = !clientHasSampling
      ? "lacks sampling support"
      : "has sampling but lacks tools support";
    logger.info(
      `Session ${sessionId}: Client ${reason}, initializing ACP shim`,
    );

    await samplingShim.initialize(sessionId);

    // Augment capabilities so upstream servers see full sampling support.
    // Preserve any existing sampling fields (like context) while adding tools.
    // This global augmentation is safe - buildClientCapabilities() filters
    // per-server based on dangerouslyEnableSampling, so only trusted servers
    // will see the sampling capability. Untrusted servers remain unaware.
    const upstreamCapabilities: ClientCapabilities = {
      ...clientCapabilities,
      sampling: { ...clientCapabilities.sampling, tools: {} },
    };

    return { activeShim: samplingShim, upstreamCapabilities };
  } catch (error) {
    logger.error(
      "Failed to initialize sampling shim, continuing without sampling support",
      error instanceof Error ? error : new Error(String(error)),
    );
    return {
      activeShim: undefined,
      upstreamCapabilities: clientCapabilities,
    };
  }
}
