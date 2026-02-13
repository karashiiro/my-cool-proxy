// Set CI to reduce log noise during tests
process.env.CI = "true";

// Pre-load suites adapters to ensure they're available for module resolution
import "@suites/di.inversify";
import "@suites/doubles.vitest";
