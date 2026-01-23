import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { resolve as pathResolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ConsoleLogger stdout/stderr separation", () => {
  it("must never write to stdout", async () => {
    const result = await runLoggerInChildProcess();

    // Assert: stdout must be completely empty
    // If this fails, it means logs are going to stdout which will
    // corrupt the MCP protocol in stdio mode
    expect(result.stdout).toBe("");

    // stderr should contain our log messages
    expect(result.stderr).toContain("test info");
    expect(result.stderr).toContain("test error");
    expect(result.stderr).toContain("test debug");
  }, 15000);
});

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function runLoggerInChildProcess(): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    // Run tsx to execute a TypeScript file that uses the logger
    const testScriptPath = pathResolve(__dirname, "logger.test-helper.ts");

    // Set cwd to apps/gateway so pnpm can find tsx in its devDependencies
    const gatewayRoot = pathResolve(__dirname, "../..");
    const child = spawn("pnpm", ["exec", "tsx", testScriptPath], {
      cwd: gatewayRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      // If there was an error, include it in the rejection
      if (code !== 0 && stderr) {
        reject(
          new Error(
            `Child process exited with code ${code}. stderr: ${stderr}`,
          ),
        );
        return;
      }

      resolve({
        stdout,
        stderr,
        exitCode: code,
      });
    });

    child.on("error", (err) => {
      reject(new Error(`Child process error: ${err.message}`));
    });

    // Timeout after 12 seconds
    setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Child process timeout. stdout: ${stdout}, stderr: ${stderr}`,
        ),
      );
    }, 30000);
  });
}
