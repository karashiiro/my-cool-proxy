import { ConsoleLogger } from "./logger.js";

// This script is run in a child process to test stdout/stderr separation
const logger = new ConsoleLogger();

// Make various log calls
logger.info("test info");
logger.error("test error");
logger.debug("test debug");
logger.error(new Error("test error object"));
logger.error("test context", new Error("test error with context"));

// Wait for pino to flush before exiting
await new Promise((resolve) => setTimeout(resolve, 500));
