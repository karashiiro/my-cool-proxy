import { describe, it, expect } from "vitest";
import { getErrorMessage } from "./error-utils.js";

describe("getErrorMessage", () => {
  it("should return message from Error instances", () => {
    const error = new Error("Something went wrong");
    expect(getErrorMessage(error)).toBe("Something went wrong");
  });

  it("should return message from custom Error subclasses", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const error = new CustomError("Custom error message");
    expect(getErrorMessage(error)).toBe("Custom error message");
  });

  it("should convert string values directly", () => {
    expect(getErrorMessage("string error")).toBe("string error");
  });

  it("should convert number values to string", () => {
    expect(getErrorMessage(404)).toBe("404");
  });

  it("should convert null to string", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("should convert undefined to string", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("should convert objects to string representation", () => {
    const obj = { code: "ERR_001" };
    expect(getErrorMessage(obj)).toBe("[object Object]");
  });

  it("should handle objects with custom toString", () => {
    const obj = {
      toString() {
        return "Custom string representation";
      },
    };
    expect(getErrorMessage(obj)).toBe("Custom string representation");
  });
});
