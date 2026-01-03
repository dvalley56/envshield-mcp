import { describe, it, expect } from "vitest";
import { CommandExecutor } from "../core/executor.js";
import { Scrubber } from "../core/scrubber.js";

describe("CommandExecutor", () => {
  const scrubber = new Scrubber("placeholder", []);

  describe("execute", () => {
    it("executes a simple command and returns output", async () => {
      const executor = new CommandExecutor(scrubber, []);

      const result = await executor.execute({
        command: "echo hello",
        secrets: new Map(),
        timeout: 5000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
      expect(result.stderr).toBe("");
    });

    it("injects secrets as environment variables", async () => {
      const executor = new CommandExecutor(scrubber, []);
      const secrets = new Map([["MY_SECRET", "secret123"]]);

      const result = await executor.execute({
        command: "echo $MY_SECRET",
        secrets,
        timeout: 5000,
      });

      expect(result.exitCode).toBe(0);
      // Secret should be scrubbed from output
      expect(result.stdout.trim()).toBe("[REDACTED:MY_SECRET]");
    });

    it("scrubs secrets from stdout", async () => {
      const executor = new CommandExecutor(scrubber, []);
      const secrets = new Map([["API_KEY", "mysecretkey"]]);

      const result = await executor.execute({
        command: "echo 'The key is mysecretkey'",
        secrets,
        timeout: 5000,
      });

      expect(result.stdout).toContain("[REDACTED:API_KEY]");
      expect(result.stdout).not.toContain("mysecretkey");
      expect(result.redactedCount).toBeGreaterThan(0);
    });

    it("blocks dangerous commands", async () => {
      const executor = new CommandExecutor(scrubber, ["rm -rf", "sudo"]);

      const result = await executor.execute({
        command: "rm -rf /",
        secrets: new Map(),
        timeout: 5000,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("blocked");
    });

    it("respects timeout", async () => {
      const executor = new CommandExecutor(scrubber, []);

      const result = await executor.execute({
        command: "sleep 10",
        secrets: new Map(),
        timeout: 100,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("timeout");
    });
  });
});
