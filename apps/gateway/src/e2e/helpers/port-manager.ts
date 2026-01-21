import { createServer } from "node:net";

/**
 * Allocates an available port by creating a temporary server on port 0.
 * The OS assigns an available port, which we capture and return.
 *
 * @returns Promise that resolves to an available port number
 */
export async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.listen(0, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to get port from server address"));
        return;
      }

      const port = address.port;

      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(port);
        }
      });
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}
