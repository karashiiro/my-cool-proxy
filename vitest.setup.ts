// Set QUIET_LOGS to reduce log noise during tests
process.env.QUIET_LOGS = "true";

// Pre-load suites adapters to ensure they're available for module resolution
import "@suites/di.inversify";
import "@suites/doubles.vitest";
