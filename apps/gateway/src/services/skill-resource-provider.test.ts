import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillResourceProvider } from "./skill-resource-provider.js";
import type {
  ISkillDiscoveryService,
  ILogger,
  SkillMetadata,
} from "../types/interfaces.js";

// Mock logger factory
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

// Mock skill discovery service factory
const createMockSkillService = (options: {
  skills?: SkillMetadata[];
  skillContent?: Map<string, string>;
  skillResources?: Map<string, string>;
}): ISkillDiscoveryService => ({
  discoverSkills: vi.fn().mockResolvedValue(options.skills ?? []),
  getSkillContent: vi.fn().mockImplementation(async (name: string) => {
    return options.skillContent?.get(name) ?? null;
  }),
  getSkillResource: vi
    .fn()
    .mockImplementation(async (name: string, path: string) => {
      return options.skillResources?.get(`${name}/${path}`) ?? null;
    }),
  ensureSkillsDirectory: vi.fn(),
});

describe("SkillResourceProvider", () => {
  let provider: SkillResourceProvider;
  let mockSkillService: ISkillDiscoveryService;
  let mockLogger: ILogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockSkillService = createMockSkillService({});
    provider = new SkillResourceProvider(mockSkillService, mockLogger);
  });

  describe("listResources", () => {
    it("should return skills as resources with gw-skill:// URIs", async () => {
      const skills: SkillMetadata[] = [
        {
          name: "pdf-rotation",
          description: "Rotate PDFs",
          path: "/skills/pdf-rotation",
        },
        {
          name: "code-review",
          description: "Review code",
          path: "/skills/code-review",
        },
      ];
      mockSkillService = createMockSkillService({ skills });
      provider = new SkillResourceProvider(mockSkillService, mockLogger);

      const result = await provider.listResources();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        uri: "gw-skill://pdf-rotation",
        name: "pdf-rotation",
        description: "Rotate PDFs",
        mimeType: "text/markdown",
      });
      expect(result[1]).toEqual({
        uri: "gw-skill://code-review",
        name: "code-review",
        description: "Review code",
        mimeType: "text/markdown",
      });
    });

    it("should return empty array when no skills exist", async () => {
      const result = await provider.listResources();

      expect(result).toEqual([]);
    });
  });

  describe("handlesUri", () => {
    it("should return true for gw-skill:// URIs", () => {
      expect(provider.handlesUri("gw-skill://pdf-rotation")).toBe(true);
      expect(provider.handlesUri("gw-skill://my-skill/scripts/run.py")).toBe(
        true,
      );
    });

    it("should return false for non-skill URIs", () => {
      expect(provider.handlesUri("gw://server/resource")).toBe(false);
      expect(provider.handlesUri("file:///path/to/file")).toBe(false);
      expect(provider.handlesUri("https://example.com")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(provider.handlesUri("")).toBe(false);
    });
  });

  describe("readResource", () => {
    it("should read main SKILL.md content for base skill URI", async () => {
      const skillContent = new Map([
        ["pdf-rotation", "# PDF Rotation\n\nRotate your PDFs!"],
      ]);
      mockSkillService = createMockSkillService({ skillContent });
      provider = new SkillResourceProvider(mockSkillService, mockLogger);

      const result = await provider.readResource("gw-skill://pdf-rotation");

      expect(result).toEqual({
        contents: [
          {
            uri: "gw-skill://pdf-rotation",
            mimeType: "text/markdown",
            text: "# PDF Rotation\n\nRotate your PDFs!",
          },
        ],
      });
      expect(mockSkillService.getSkillContent).toHaveBeenCalledWith(
        "pdf-rotation",
      );
    });

    it("should read nested resource file for skill URI with path", async () => {
      const skillResources = new Map([
        ["pdf-rotation/scripts/rotate.py", "import pypdf\n\ndef rotate():"],
      ]);
      mockSkillService = createMockSkillService({ skillResources });
      provider = new SkillResourceProvider(mockSkillService, mockLogger);

      const result = await provider.readResource(
        "gw-skill://pdf-rotation/scripts/rotate.py",
      );

      expect(result).toEqual({
        contents: [
          {
            uri: "gw-skill://pdf-rotation/scripts/rotate.py",
            mimeType: "text/x-python",
            text: "import pypdf\n\ndef rotate():",
          },
        ],
      });
      expect(mockSkillService.getSkillResource).toHaveBeenCalledWith(
        "pdf-rotation",
        "scripts/rotate.py",
      );
    });

    it("should throw error for non-existent skill", async () => {
      await expect(
        provider.readResource("gw-skill://nonexistent"),
      ).rejects.toThrow("Skill resource not found: gw-skill://nonexistent");
    });

    it("should throw error for non-existent resource file", async () => {
      await expect(
        provider.readResource("gw-skill://pdf-rotation/scripts/missing.py"),
      ).rejects.toThrow("Skill resource not found");
    });

    it("should return null for non-skill URIs", async () => {
      const result = await provider.readResource("gw://server/resource");

      expect(result).toBeNull();
    });

    it("should determine correct MIME type for different file extensions", async () => {
      const skillResources = new Map([
        ["skill/scripts/run.js", "console.log('hi')"],
        ["skill/scripts/run.ts", "const x: string = 'hi'"],
        ["skill/references/api.json", "{}"],
        ["skill/references/config.yaml", "key: value"],
        ["skill/assets/setup.sh", "#!/bin/bash"],
        ["skill/docs/readme.txt", "readme"],
        ["skill/other/file.xyz", "unknown"],
      ]);
      mockSkillService = createMockSkillService({ skillResources });
      provider = new SkillResourceProvider(mockSkillService, mockLogger);

      const testCases = [
        ["gw-skill://skill/scripts/run.js", "application/javascript"],
        ["gw-skill://skill/scripts/run.ts", "text/typescript"],
        ["gw-skill://skill/references/api.json", "application/json"],
        ["gw-skill://skill/references/config.yaml", "text/yaml"],
        ["gw-skill://skill/assets/setup.sh", "application/x-sh"],
        ["gw-skill://skill/docs/readme.txt", "text/plain"],
        ["gw-skill://skill/other/file.xyz", "text/plain"],
      ];

      for (const [uri, expectedMime] of testCases) {
        const result = await provider.readResource(uri!);
        expect(result?.contents[0]?.mimeType).toBe(expectedMime);
      }
    });
  });
});
