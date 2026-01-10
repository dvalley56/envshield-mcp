import { spawn } from "child_process";
import { Scrubber } from "./scrubber.js";

export interface ExecuteOptions {
  command: string;
  secrets: Map<string, string>;
  timeout: number;
  workingDir?: string;
}

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  redactedCount: number;
}

export class CommandExecutor {
  private scrubber: Scrubber;
  private blockedCommands: string[];

  constructor(scrubber: Scrubber, blockedCommands: string[]) {
    this.scrubber = scrubber;
    this.blockedCommands = blockedCommands;
  }

  async execute(options: ExecuteOptions): Promise<ExecuteResult> {
    const { command, secrets, timeout, workingDir } = options;

    // Check for blocked commands using word-boundary-aware matching
    for (const blocked of this.blockedCommands) {
      // Escape regex special characters in the blocked pattern
      const escaped = blocked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Use word boundaries to match whole commands/pipes, not substrings
      const blockedRegex = new RegExp(`(?:^|\\s|[|&;])${escaped}(?:\\s|[|&;]|$)`);
      if (blockedRegex.test(command)) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Command blocked: contains "${blocked}"`,
          redactedCount: 0,
        };
      }
    }

    // Build environment with secrets
    const env = { ...process.env };
    for (const [name, value] of secrets) {
      env[name] = value;
    }

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let resolved = false;

      const proc = spawn(command, {
        shell: true,
        env,
        cwd: workingDir,
        detached: false,  // Ensure process group is created for killing entire tree
      });

      const timer = setTimeout(() => {
        timedOut = true;
        // Kill entire process group to prevent background processes from continuing
        try {
          // Negative PID kills the entire process group
          if (proc.pid !== undefined) {
            process.kill(-proc.pid, "SIGKILL");
          }
        } catch {
          // Fallback to killing only the parent process
          proc.kill("SIGKILL");
        }
      }, timeout);

      const done = (result: ExecuteResult) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const handleExit = (code: number | null) => {
        if (resolved) return;

        if (timedOut) {
          done({
            exitCode: 1,
            stdout: "",
            stderr: "Command timeout exceeded",
            redactedCount: 0,
          });
          return;
        }

        // Scrub secrets from output
        const scrubStdout = this.scrubber.scrub(stdout, secrets);
        const scrubStderr = this.scrubber.scrub(stderr, secrets);

        // Verify scrubbing was effective - check if any secret values remain
        const combinedOutput = scrubStdout.text + scrubStderr.text;
        for (const [name, value] of secrets) {
          if (value && combinedOutput.includes(value)) {
            // Secret value still present after scrubbing - this is a security issue
            console.error(`[envshield SECURITY WARNING] Secret "${name}" may still be present in output despite scrubbing. This could indicate: (1) The secret format doesn't match known patterns, (2) Custom redact patterns are needed, or (3) Output encoding is bypassing detection.`);
          }
        }

        done({
          exitCode: code ?? 1,
          stdout: scrubStdout.text,
          stderr: scrubStderr.text,
          redactedCount: scrubStdout.redactedCount + scrubStderr.redactedCount,
        });
      };

      proc.on("close", handleExit);
      proc.on("exit", handleExit);

      proc.on("error", (err) => {
        done({
          exitCode: 1,
          stdout: "",
          stderr: err.message,
          redactedCount: 0,
        });
      });
    });
  }
}
