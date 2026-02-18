import { createServer } from "node:net";

// When running under Vitest, each worker gets a unique ID (1-indexed).
// We use this to assign non-overlapping port ranges so parallel workers
// never race for the same port.  Outside Vitest the ID is undefined and we
// fall back to the OS-assigned approach.
const VITEST_WORKER_ID = process.env.VITEST_WORKER_ID;
const PORTS_PER_WORKER = 200;
// Use the range 10000–19999 – well below the Linux ephemeral range
// (32768–60999) so these ports are never assigned by listen(0) calls in
// production code running in the same process.
const WORKER_BASE_PORT = VITEST_WORKER_ID
  ? 10000 + (parseInt(VITEST_WORKER_ID, 10) - 1) * PORTS_PER_WORKER
  : 0;

let portCounter = WORKER_BASE_PORT;

/**
 * Allocates an available port for use in tests.
 *
 * When running under Vitest each worker process receives a unique
 * `VITEST_WORKER_ID`.  We exploit this to hand out ports from a
 * non-overlapping range per worker, which eliminates the TOCTOU race where
 * two parallel workers both call `listen(0)`, receive the same OS-assigned
 * ephemeral port, close their probe servers, and then race to bind to that
 * port for real.
 *
 * Outside of Vitest (e.g. production code) the function falls back to the
 * original `listen(0)` strategy so behaviour is unchanged.
 *
 * @returns Promise that resolves to an available port number
 */
export async function allocatePort(): Promise<number> {
  if (VITEST_WORKER_ID !== undefined) {
    return portCounter++;
  }

  // Production fallback: ask the OS for a free ephemeral port.
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
