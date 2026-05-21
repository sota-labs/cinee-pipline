import { describe, it, expect } from "vitest";
import { extractResponse } from "../utils/extractResponse.js";

describe("extractResponse", () => {
  it("extracts content between delimiters", () => {
    const input = 'some preamble\n<<<RESPONSE_START>>>\n{"key":"value"}\n<<<RESPONSE_END>>>\ntrailing';
    expect(extractResponse(input)).toBe('{"key":"value"}');
  });

  it("strips markdown json code block", () => {
    const input = "<<<RESPONSE_START>>>\n```json\n{\"key\":\"value\"}\n```\n<<<RESPONSE_END>>>";
    expect(extractResponse(input)).toBe('{"key":"value"}');
  });

  it("strips plain markdown code block", () => {
    const input = "<<<RESPONSE_START>>>\n```\n{\"key\":\"value\"}\n```\n<<<RESPONSE_END>>>";
    expect(extractResponse(input)).toBe('{"key":"value"}');
  });

  it("handles markdown code block without delimiters (fallback)", () => {
    const input = "```json\n{\"writing_style\":\"casual\"}\n```";
    expect(extractResponse(input)).toBe('{"writing_style":"casual"}');
  });

  it("falls back to JSON extraction when no delimiters", () => {
    const input = 'Here is the result: {"key":"value"} done.';
    expect(extractResponse(input)).toBe('{"key":"value"}');
  });

  it("returns trimmed raw string when no JSON found", () => {
    const input = "  no json here  ";
    expect(extractResponse(input)).toBe("no json here");
  });

  it("handles nested JSON objects correctly", () => {
    const input = '<<<RESPONSE_START>>>\n{"a":{"b":1}}\n<<<RESPONSE_END>>>';
    expect(extractResponse(input)).toBe('{"a":{"b":1}}');
  });
});
