import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEnvshieldServer } from "../mcp/server.js";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "envshield-integration-"));

    // Create .env with various secrets
    await writeFile(
      join(tempDir, ".env"),
      `
STRIPE_KEY=sk_live_realkey123
DATABASE_URL=postgres://user:password@localhost:5432/db
API_SECRET=supersecretvalue
`.trim()
    );

    // Create .env.local that overrides one value
    await writeFile(
      join(tempDir, ".env.local"),
      `
DATABASE_URL=postgres://user:devpassword@localhost:5432/devdb
`.trim()
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("full workflow: list, check, execute with scrubbing", async () => {
    const server = await createEnvshieldServer(tempDir);

    // 1. List secrets
    const listResult = (await server.callTool("list_secrets", {})) as {
      secrets: string[];
    };
    expect(listResult.secrets).toContain("STRIPE_KEY");
    expect(listResult.secrets).toContain("DATABASE_URL");
    expect(listResult.secrets).toContain("API_SECRET");

    // 2. Check secret with override
    const checkResult = (await server.callTool("check_secret_exists", {
      name: "DATABASE_URL",
    })) as { exists: boolean; sources: string[]; activeSource: string };
    expect(checkResult.exists).toBe(true);
    expect(checkResult.sources).toEqual([".env", ".env.local"]);
    expect(checkResult.activeSource).toBe(".env.local");

    // 3. Execute command with secrets - verify scrubbing
    const execResult = (await server.callTool("run_with_secrets", {
      command: "echo \"Stripe: $STRIPE_KEY, DB: $DATABASE_URL\"",
      secrets: ["STRIPE_KEY", "DATABASE_URL"],
    })) as { exitCode: number; stdout: string; stderr: string };

    expect(execResult.exitCode).toBe(0);
    expect(execResult.stdout).toContain("[REDACTED:STRIPE_KEY]");
    expect(execResult.stdout).toContain("[REDACTED:DATABASE_URL]");
    expect(execResult.stdout).not.toContain("sk_live_realkey123");
    expect(execResult.stdout).not.toContain("devpassword");
  });

  it("pattern detection catches unknown secrets in output", async () => {
    const server = await createEnvshieldServer(tempDir);

    // Command that returns a Stripe-like key not in our .env
    const result = (await server.callTool("run_with_secrets", {
      command: "echo 'Found key: sk_test_unknownkey456'",
      secrets: [],
    })) as { stdout: string; redactedCount: number };

    expect(result.stdout).toContain("[REDACTED:STRIPE_TEST_KEY]");
    expect(result.stdout).not.toContain("sk_test_unknownkey456");
    expect(result.redactedCount).toBe(1);
  });

  it("blocks dangerous commands", async () => {
    const server = await createEnvshieldServer(tempDir);

    const result = (await server.callTool("run_with_secrets", {
      command: "sudo rm -rf /",
      secrets: [],
    })) as { exitCode: number; stderr: string };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("blocked");
  });
});
