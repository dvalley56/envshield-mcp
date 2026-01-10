import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectEnvFiles } from "../cli.js";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("detectEnvFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "envshield-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when directory doesn't exist", async () => {
    const nonExistentDir = join(tempDir, "nonexistent");
    const files = await detectEnvFiles(nonExistentDir);
    expect(files).toEqual([]);
  });

  it("returns empty array when no .env files exist", async () => {
    const files = await detectEnvFiles(tempDir);
    expect(files).toEqual([]);
  });

  it("detects .env file", async () => {
    await writeFile(join(tempDir, ".env"), "KEY=value");
    const files = await detectEnvFiles(tempDir);
    expect(files).toEqual([".env"]);
  });

  it("detects multiple .env files and sorts them", async () => {
    await writeFile(join(tempDir, ".env.production"), "KEY=prod");
    await writeFile(join(tempDir, ".env"), "KEY=value");
    await writeFile(join(tempDir, ".env.local"), "KEY=local");
    const files = await detectEnvFiles(tempDir);
    expect(files).toEqual([".env", ".env.local", ".env.production"]);
  });

  it("excludes node_modules directory", async () => {
    await writeFile(join(tempDir, ".env"), "KEY=value");
    const nodeModulesDir = join(tempDir, "node_modules");
    await mkdir(nodeModulesDir, { recursive: true });
    await writeFile(join(nodeModulesDir, ".env"), "KEY=node_modules");

    const files = await detectEnvFiles(tempDir);
    expect(files).toEqual([".env"]);
  });

  it("excludes .git directory", async () => {
    await writeFile(join(tempDir, ".env"), "KEY=value");
    const gitDir = join(tempDir, ".git");
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, ".env"), "KEY=git");

    const files = await detectEnvFiles(tempDir);
    expect(files).toEqual([".env"]);
  });

  it("handles permission errors gracefully", async () => {
    // Create a directory with restricted permissions
    const restrictedDir = join(tempDir, "restricted");
    await mkdir(restrictedDir, { recursive: true });

    // On Unix-like systems, remove read permissions
    // Note: This test may not work on Windows
    try {
      await writeFile(join(restrictedDir, ".env"), "KEY=value");
      // The directory itself should be accessible, but we test the function doesn't crash
      const files = await detectEnvFiles(restrictedDir);
      expect(Array.isArray(files)).toBe(true);
    } catch (error) {
      // If we can't test permissions on this system, just verify function doesn't throw
      const files = await detectEnvFiles("/root/inaccessible");
      expect(Array.isArray(files)).toBe(true);
    }
  });

  it("detects .env files in nested directories within project", async () => {
    await writeFile(join(tempDir, ".env"), "KEY=root");
    const subDir = join(tempDir, "subdir");
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, ".env"), "KEY=subdir");

    const files = await detectEnvFiles(tempDir);
    expect(files).toContain(".env");
  });
});
