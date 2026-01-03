import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadSecrets, SecretStore } from "../core/secrets.js";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("secrets", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "envshield-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("loadSecrets", () => {
    it("loads secrets from .env file", async () => {
      await writeFile(join(tempDir, ".env"), "API_KEY=secret123\nDB_URL=postgres://localhost");

      const store = await loadSecrets(tempDir, [".env"]);

      expect(store.names()).toEqual(["API_KEY", "DB_URL"]);
      expect(store.get("API_KEY")).toBe("secret123");
      expect(store.get("DB_URL")).toBe("postgres://localhost");
    });

    it("returns empty store when no env files exist", async () => {
      const store = await loadSecrets(tempDir, [".env"]);
      expect(store.names()).toEqual([]);
    });

    it("later files override earlier files", async () => {
      await writeFile(join(tempDir, ".env"), "API_KEY=original");
      await writeFile(join(tempDir, ".env.local"), "API_KEY=override");

      const store = await loadSecrets(tempDir, [".env", ".env.local"]);

      expect(store.get("API_KEY")).toBe("override");
      expect(store.sources("API_KEY")).toEqual([".env", ".env.local"]);
      expect(store.activeSource("API_KEY")).toBe(".env.local");
    });
  });
});
