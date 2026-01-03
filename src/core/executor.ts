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

    // Check for blocked commands
    for (const blocked of this.blockedCommands) {
      if (command.includes(blocked)) {
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
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
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
