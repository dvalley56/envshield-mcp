import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "../core/config.js";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("config", () => {
  describe("DEFAULT_CONFIG", () => {
    it("has expected default values", () => {
      expect(DEFAULT_CONFIG.envFiles).toEqual([".env", ".env.local"]);
      expect(DEFAULT_CONFIG.redactMode).toBe("placeholder");
      expect(DEFAULT_CONFIG.redactPatterns).toEqual([]);
      expect(DEFAULT_CONFIG.allowedCommands).toBeNull();
      expect(DEFAULT_CONFIG.blockedCommands).toEqual(["rm -rf", "sudo"]);
    });
  });

  describe("loadConfig", () => {
    it("returns default config when no config files exist", async () => {
      const config = await loadConfig("/nonexistent/path");
      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });
});

describe("loadConfig with files", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "envshield-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("loads local .envshield.json and merges with defaults", async () => {
    const localConfig = {
      redactMode: "asterisk",
      redactPatterns: ["custom_.*"],
    };
    await writeFile(
      join(tempDir, ".envshield.json"),
      JSON.stringify(localConfig)
    );

    const config = await loadConfig(tempDir);

    expect(config.redactMode).toBe("asterisk");
    expect(config.redactPatterns).toEqual(["custom_.*"]);
    expect(config.envFiles).toEqual(DEFAULT_CONFIG.envFiles); // Unchanged
  });
});
