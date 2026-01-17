import { loadConfig, EnvshieldConfig } from "../core/config.js";
import { loadSecrets, SecretStore } from "../core/secrets.js";
import { Scrubber } from "../core/scrubber.js";
import { CommandExecutor } from "../core/executor.js";

interface Tool {
  name: string;
  description: string;
  inputSchema: object;
}

interface EnvshieldServer {
  getTools(): Tool[];
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  config: EnvshieldConfig;
  secrets: SecretStore;
}

/**
 * Simple in-memory rate limiter to prevent command flooding.
 * Allows up to `maxRequests` commands within `windowMs` milliseconds.
 */
class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if a request should be allowed.
   * @returns true if allowed, false if rate limited
   */
  check(): boolean {
    const now = Date.now();

    // Remove timestamps outside the current window
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }

  /**
   * Get time until next request is allowed (in milliseconds).
   * @returns milliseconds to wait, or 0 if request can be made now
   */
  getWaitTime(): number {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

    if (this.timestamps.length < this.maxRequests) {
      return 0;
    }

    const oldestTimestamp = this.timestamps[0];
    return Math.max(0, this.windowMs - (now - oldestTimestamp));
  }
}

export async function createEnvshieldServer(
  projectDir: string
): Promise<EnvshieldServer> {
  const config = await loadConfig(projectDir);
  const secrets = await loadSecrets(projectDir, config.envFiles);
  const scrubber = new Scrubber(config.redactMode, config.redactPatterns);
  const executor = new CommandExecutor(scrubber, config.blockedCommands);

  // Rate limiter: only create if enabled in config
  const rateLimiter = config.rateLimit.enabled
    ? new RateLimiter(config.rateLimit.maxRequests, config.rateLimit.windowMs)
    : null;

  const tools: Tool[] = [
    {
      name: "list_secrets",
      description:
        "List all available secret names (never returns values). Use this to discover what secrets are available.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "check_secret_exists",
      description:
        "Check if a specific secret exists and which files define it.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The secret name to check",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "run_with_secrets",
      description:
        "Execute a shell command with secrets injected as environment variables. The command output will have secret values scrubbed. Use standard env var syntax like $SECRET_NAME in your command.",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
          secrets: {
            type: "array",
            items: { type: "string" },
            description: "List of secret names to inject as env vars",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000)",
          },
          workingDir: {
            type: "string",
            description: "Working directory for the command",
          },
        },
        required: ["command", "secrets"],
      },
    },
  ];

  async function callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    switch (name) {
      case "list_secrets":
        return { secrets: secrets.names() };

      case "check_secret_exists": {
        const secretName = args.name as string;
        const exists = secrets.has(secretName);
        return {
          exists,
          sources: exists ? secrets.sources(secretName) : [],
          activeSource: exists ? secrets.activeSource(secretName) : null,
        };
      }

      case "run_with_secrets": {
        // Check rate limit before executing command (if enabled)
        if (rateLimiter && !rateLimiter.check()) {
          const waitTime = rateLimiter.getWaitTime();
          return {
            exitCode: 1,
            stdout: "",
            stderr: `Rate limit exceeded. Too many commands requested. Please wait ${Math.ceil(waitTime / 1000)} seconds before trying again.`,
            redactedCount: 0,
          };
        }

        const command = args.command as string;
        const secretNames = args.secrets as string[];
        const timeout = (args.timeout as number) ?? 30000;
        const workingDir = args.workingDir as string | undefined;

        // Validate all secrets exist
        const missingSecrets = secretNames.filter((s) => !secrets.has(s));
        if (missingSecrets.length > 0) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `Secrets not found: ${missingSecrets.join(", ")}`,
            redactedCount: 0,
          };
        }

        // Build secrets map for requested secrets only
        const secretsMap = new Map<string, string>();
        for (const name of secretNames) {
          const value = secrets.get(name);
          if (value) secretsMap.set(name, value);
        }

        return executor.execute({
          command,
          secrets: secretsMap,
          timeout,
          workingDir,
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  return {
    getTools: () => tools,
    callTool,
    config,
    secrets,
  };
}
