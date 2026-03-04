import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

/**
 * Minimal ACP echo agent for E2E testing.
 *
 * - Receives prompts with text content blocks
 * - Echoes back the text with an "ACP echo: " prefix
 * - Communicates over stdio (stdin/stdout via ndjson)
 */
class EchoAgent implements acp.Agent {
  constructor(private readonly connection: acp.AgentSideConnection) {}

  async initialize(): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: {
        name: "echo-agent",
        version: "1.0.0",
      },
      agentCapabilities: {
        promptCapabilities: {
          image: true,
          audio: true,
        },
      },
    };
  }

  async authenticate(): Promise<acp.AuthenticateResponse | void> {
    // No auth required
  }

  async newSession(): Promise<acp.NewSessionResponse> {
    return {
      sessionId: `echo-session-${Date.now()}`,
    };
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    // Extract text from prompt content blocks
    const textParts: string[] = [];
    for (const block of params.prompt) {
      if ("text" in block && typeof block.text === "string") {
        textParts.push(block.text);
      }
    }

    const echoText = `ACP echo: ${textParts.join(" | ")}`;

    // Send the echoed text back as a session update
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: echoText,
        },
      },
    });

    return { stopReason: "end_turn" };
  }

  async cancel(): Promise<void> {
    // Nothing to cancel in this simple agent
  }
}

// Start the echo agent on stdio
const input = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
const stream = acp.ndJsonStream(input, output);

new acp.AgentSideConnection((conn) => new EchoAgent(conn), stream);
