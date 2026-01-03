import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEnvshieldServer } from "../mcp/server.js";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("EnvshieldServer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "envshield-test-"));
    await writeFile(
      join(tempDir, ".env"),
      "API_KEY=test_secret_123\nDB_URL=postgres://localhost"
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("creates server with three tools", async () => {
    const server = await createEnvshieldServer(tempDir);
    const tools = server.getTools();

    expect(tools.map((t) => t.name)).toEqual([
      "list_secrets",
      "check_secret_exists",
      "run_with_secrets",
    ]);
  });

  describe("list_secrets", () => {
    it("returns secret names without values", async () => {
      const server = await createEnvshieldServer(tempDir);
      const result = await server.callTool("list_secrets", {});

      expect(result).toEqual({
        secrets: ["API_KEY", "DB_URL"],
      });
    });
  });

  describe("check_secret_exists", () => {
    it("returns true for existing secret", async () => {
      const server = await createEnvshieldServer(tempDir);
      const result = await server.callTool("check_secret_exists", {
        name: "API_KEY",
      });

      expect(result).toEqual({
        exists: true,
        sources: [".env"],
        activeSource: ".env",
      });
    });

    it("returns false for non-existing secret", async () => {
      const server = await createEnvshieldServer(tempDir);
      const result = await server.callTool("check_secret_exists", {
        name: "NONEXISTENT",
      });

      expect(result).toEqual({
        exists: false,
        sources: [],
        activeSource: null,
      });
    });
  });

  describe("run_with_secrets", () => {
    it("executes command with secrets injected", async () => {
      const server = await createEnvshieldServer(tempDir);
      const result = await server.callTool("run_with_secrets", {
        command: "echo $API_KEY",
        secrets: ["API_KEY"],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("[REDACTED:API_KEY]");
      expect(result.stdout).not.toContain("test_secret_123");
    });

    it("returns error for non-existing secret", async () => {
      const server = await createEnvshieldServer(tempDir);
      const result = await server.callTool("run_with_secrets", {
        command: "echo test",
        secrets: ["NONEXISTENT"],
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not found");
    });
  });
});
