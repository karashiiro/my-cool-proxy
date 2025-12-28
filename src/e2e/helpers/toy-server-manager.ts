import {
  startHttpCalculatorServer,
  startHttpDataServer,
} from "../fixtures/toy-servers/index.js";

type ToyServerType = "calculator" | "data";

interface ToyServerInstance {
  type: ToyServerType;
  port: number;
  close: () => Promise<void>;
}

/**
 * Manages toy MCP servers for E2E tests
 */
export class ToyServerManager {
  private servers: Map<string, ToyServerInstance> = new Map();

  /**
   * Starts a toy HTTP server on the specified port
   *
   * @param serverType - Type of server to start
   * @param port - Port to listen on
   * @returns The server key for tracking
   */
  async startHttp(serverType: ToyServerType, port: number): Promise<string> {
    const key = `${serverType}-${port}`;

    if (this.servers.has(key)) {
      throw new Error(`Server ${key} is already running`);
    }

    let closeFunc: () => Promise<void>;

    switch (serverType) {
      case "calculator": {
        const server = await startHttpCalculatorServer(port);
        closeFunc = server.close;
        break;
      }
      case "data": {
        const server = await startHttpDataServer(port);
        closeFunc = server.close;
        break;
      }
      default:
        throw new Error(`Unknown server type: ${serverType}`);
    }

    this.servers.set(key, {
      type: serverType,
      port,
      close: closeFunc,
    });

    // Wait a bit for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    return key;
  }

  /**
   * Stops all running toy servers
   */
  async stopAll(): Promise<void> {
    const closePromises = Array.from(this.servers.values()).map((server) =>
      server.close(),
    );

    await Promise.all(closePromises);
    this.servers.clear();
  }

  /**
   * Stops a specific server by key
   */
  async stop(key: string): Promise<void> {
    const server = this.servers.get(key);
    if (server) {
      await server.close();
      this.servers.delete(key);
    }
  }

  /**
   * Gets the number of running servers
   */
  count(): number {
    return this.servers.size;
  }
}
