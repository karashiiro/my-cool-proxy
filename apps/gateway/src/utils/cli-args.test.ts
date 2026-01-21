import { describe, it, expect } from "vitest";
import { parseArgs } from "./cli-args.js";

describe("cli-args", () => {
  describe("parseArgs", () => {
    it("should return default values for empty args", () => {
      const result = parseArgs([]);

      expect(result.showConfigPath).toBe(false);
      expect(result.help).toBe(false);
    });

    it("should detect --config-path flag", () => {
      const result = parseArgs(["--config-path"]);

      expect(result.showConfigPath).toBe(true);
    });

    it("should detect -c shorthand for config path", () => {
      const result = parseArgs(["-c"]);

      expect(result.showConfigPath).toBe(true);
    });

    it("should detect --help flag", () => {
      const result = parseArgs(["--help"]);

      expect(result.help).toBe(true);
    });

    it("should detect -h shorthand for help", () => {
      const result = parseArgs(["-h"]);

      expect(result.help).toBe(true);
    });

    it("should handle multiple flags", () => {
      const result = parseArgs(["--config-path", "--help"]);

      expect(result.showConfigPath).toBe(true);
      expect(result.help).toBe(true);
    });

    it("should ignore unknown flags", () => {
      const result = parseArgs(["--unknown", "-x", "random"]);

      expect(result.showConfigPath).toBe(false);
      expect(result.help).toBe(false);
    });

    it("should find flags among other arguments", () => {
      const result = parseArgs(["some", "arg", "--config-path", "another"]);

      expect(result.showConfigPath).toBe(true);
    });
  });
});
