import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./skill-frontmatter-parser.js";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with name and description", () => {
    const content = `---
name: my-skill
description: A cool skill
---

# Body content`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({
      ok: true,
      frontmatter: { name: "my-skill", description: "A cool skill" },
    });
  });

  it("parses frontmatter with only name", () => {
    const content = `---
name: solo-skill
---
body`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({
      ok: true,
      frontmatter: { name: "solo-skill" },
    });
  });

  it("returns no_frontmatter when delimiters are missing", () => {
    const result = parseFrontmatter("# Just a heading\nSome text");
    expect(result).toEqual({ ok: false, error: "no_frontmatter" });
  });

  it("returns no_frontmatter for empty string", () => {
    const result = parseFrontmatter("");
    expect(result).toEqual({ ok: false, error: "no_frontmatter" });
  });

  it("returns no_frontmatter when only opening delimiter exists", () => {
    const result = parseFrontmatter("---\nname: test\nbody content");
    expect(result).toEqual({ ok: false, error: "no_frontmatter" });
  });

  it("returns error for invalid YAML", () => {
    const content = `---
: : : [broken
---`;

    const result = parseFrontmatter(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid YAML in frontmatter");
    }
  });

  it("returns empty_or_non_object for empty frontmatter block", () => {
    // YAML parses an empty string as null
    const content = `---

---
body`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({ ok: false, error: "empty_or_non_object" });
  });

  it("returns empty_or_non_object when YAML parses to a scalar", () => {
    const content = `---
just a string
---`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({ ok: false, error: "empty_or_non_object" });
  });

  it("accepts extra fields beyond name and description", () => {
    const content = `---
name: test
version: 2
custom: true
---`;

    const result = parseFrontmatter(content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frontmatter.name).toBe("test");
      expect((result.frontmatter as Record<string, unknown>)["version"]).toBe(
        2,
      );
    }
  });

  it("does not match frontmatter that doesn't start at beginning of file", () => {
    const content = `Some leading text
---
name: hidden
---`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({ ok: false, error: "no_frontmatter" });
  });
});
