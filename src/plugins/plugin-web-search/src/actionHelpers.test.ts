/**
 * Tests for shared action helper utilities.
 */
import { describe, it, expect } from "bun:test";
import {
  extractString,
  extractPositiveInt,
  capQueryLength,
  MAX_QUERY_LENGTH,
} from "./actionHelpers";

describe("extractString", () => {
  it("returns trimmed string for valid input", () => {
    expect(extractString("  hello  ")).toBe("hello");
  });

  it("returns undefined for empty/whitespace string", () => {
    expect(extractString("")).toBeUndefined();
    expect(extractString("   ")).toBeUndefined();
  });

  it("returns undefined for non-string types", () => {
    expect(extractString(42)).toBeUndefined();
    expect(extractString(null)).toBeUndefined();
    expect(extractString(undefined)).toBeUndefined();
    expect(extractString({ query: "x" })).toBeUndefined();
    expect(extractString(true)).toBeUndefined();
  });
});

describe("extractPositiveInt", () => {
  it("clamps within range", () => {
    expect(extractPositiveInt(10, 1, 20, 5)).toBe(10);
    expect(extractPositiveInt(0, 1, 20, 5)).toBe(5); // below 1 → fallback
    expect(extractPositiveInt(50, 1, 20, 5)).toBe(20); // clamped to max
  });

  it("coerces string numbers", () => {
    expect(extractPositiveInt("10", 1, 20, 5)).toBe(10);
  });

  it("returns fallback for non-numeric values", () => {
    expect(extractPositiveInt("ten", 1, 20, 5)).toBe(5);
    expect(extractPositiveInt(NaN, 1, 20, 5)).toBe(5);
    expect(extractPositiveInt(null, 1, 20, 5)).toBe(5);
    expect(extractPositiveInt(undefined, 1, 20, 5)).toBe(5);
  });

  it("rounds floats", () => {
    expect(extractPositiveInt(3.7, 1, 20, 5)).toBe(4);
  });
});

describe("capQueryLength", () => {
  it("returns short queries unchanged", () => {
    expect(capQueryLength("short query")).toBe("short query");
  });

  it("truncates at word boundary when possible", () => {
    const long = "a ".repeat(300).trim(); // 599 chars
    const capped = capQueryLength(long);
    expect(capped.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
    // Should not end mid-word
    expect(capped.endsWith("a")).toBe(true);
  });

  it("hard-truncates when no good word boundary exists", () => {
    const noSpaces = "x".repeat(600);
    const capped = capQueryLength(noSpaces);
    expect(capped.length).toBe(MAX_QUERY_LENGTH);
  });

  it("respects custom max", () => {
    const capped = capQueryLength("hello world foo bar", 11);
    expect(capped.length).toBeLessThanOrEqual(11);
    expect(capped).toBe("hello world");
  });
});
