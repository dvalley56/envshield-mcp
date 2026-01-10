#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { cwd } from "process";
import { startMCPServer } from "./mcp/mcp.js";
import { VERSION } from "./version.js";
import { glob } from "fast-glob";

const GLOBAL_CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");

interface ClaudeSettings {
  mcpServers?: Record<string, { command: string; args: string[] }>;
  deny?: string[];
  [key: string]: unknown;
}

async function loadSettings(path: string): Promise<ClaudeSettings> {
  if (!existsSync(path)) {
    return {};
  }
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}

/**
 * Detects .env files in a project directory.
 *
 * @param projectDir - The project directory to search for .env files
 * @returns A sorted array of .env file names (relative paths), or empty array on error
 */
export async function detectEnvFiles(projectDir: string): Promise<string[]> {
  try {
    const files = await glob(".env*", {
      cwd: projectDir,
      onlyFiles: true,
      ignore: ["node_modules/**", ".git/**"],
    });

    return files.sort();
  } catch (error) {
    // Handle edge cases: directory doesn't exist, permission errors, etc.
    // Return empty array to allow graceful degradation
    return [];
  }
}

async function saveSettings(path: string, settings: ClaudeSettings): Promise<void> {
  const dir = join(path, "..");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path, JSON.stringify(settings, null, 2));
}

// Default .envshield.json template
// Note: This is valid JSON without comments (users can add documentation themselves)
const DEFAULT_ENVSHIELD_CONFIG = `{
  "_comment_envFiles": "Environment files to load secrets from (earlier files take precedence)",
  "envFiles": [".env", ".env.local"],

  "_comment_redactMode": "How to redact secrets: 'placeholder', 'asterisk', or 'partial'",
  "redactMode": "placeholder",

  "_comment_redactPatterns": "Custom regex patterns (built-in: Stripe, GitHub, AWS, OpenAI, JWT)",
  "redactPatterns": [],

  "_comment_allowedCommands": "Allow ONLY these commands (null = allow all except blocked)",
  "allowedCommands": null,

  "_comment_blockedCommands": "Commands to block for security (e.g., ['rm -rf', 'sudo'])",
  "blockedCommands": ["rm -rf", "sudo"],

  "_comment_rateLimit": "Rate limiting to prevent command flooding (disabled by default for local use)",
  "rateLimit": {
    "enabled": false,
    "maxRequests": 30,
    "windowMs": 60000
  }
}`;

async function init(global: boolean, dryRun: boolean): Promise<void> {
  const scope = global ? "global" : "project";
  console.log(`envshield init (${scope})` + (dryRun ? " (dry-run)" : ""));
  console.log("");

  const settingsPath = global ? GLOBAL_CLAUDE_SETTINGS : join(cwd(), ".claude", "settings.json");
  const existingSettings = await loadSettings(settingsPath);

  // Prepare new settings
  const newSettings: ClaudeSettings = { ...existingSettings };

  // Add MCP server
  newSettings.mcpServers = {
    ...newSettings.mcpServers,
    envshield: {
      command: "npx",
      args: ["envshield-mcp"],
    },
  };

  // Add deny rules for .env files
  const denyRules = ["Read(.env*)", "Edit(.env*)"];
  const existingDeny = newSettings.deny ?? [];
  const newDeny = [...new Set([...existingDeny, ...denyRules])];
  newSettings.deny = newDeny;

  if (dryRun) {
    console.log(`Would update ${settingsPath}:`);
    console.log("");
    console.log(JSON.stringify(newSettings, null, 2));
    console.log("");
    console.log("Run without --dry-run to apply changes.");

    // Show .envshield.json would be created
    if (!global) {
      const configPath = join(cwd(), ".envshield.json");
      if (!existsSync(configPath)) {
        console.log("");
        console.log(`Would create ${configPath} with default configuration.`);
      }
    }
  } else {
    await saveSettings(settingsPath, newSettings);
    console.log(`Updated ${settingsPath}`);
    console.log("");
    console.log("Added:");
    console.log("  - MCP server: envshield");
    console.log("  - Deny rules: Read(.env*), Edit(.env*)");

    // Create .envshield.json for project-local init only (skip if exists)
    if (!global) {
      const configPath = join(cwd(), ".envshield.json");
      if (!existsSync(configPath)) {
        await writeFile(configPath, DEFAULT_ENVSHIELD_CONFIG);
        console.log("  - Config file: .envshield.json");
      }
    }

    console.log("");
    console.log(global
      ? "envshield is now globally active. AI agents can use secrets without seeing them."
      : "envshield is now active for this project. AI agents can use secrets without seeing them."
    );
    if (!global) {
      console.log("");
      console.log("Edit .envshield.json to customize behavior.");
      console.log("To enable globally, run: envshield-mcp init --global");
    }
  }
}

async function uninit(dryRun: boolean): Promise<void> {
  console.log("envshield uninit (removes global config)" + (dryRun ? " (dry-run)" : ""));
  console.log("");

  const settingsPath = GLOBAL_CLAUDE_SETTINGS;
  const existingSettings = await loadSettings(settingsPath);

  if (!existingSettings.mcpServers?.envshield) {
    console.log("envshield is not configured in global settings.");
    console.log("");
    console.log("Nothing to undo.");
    return;
  }

  if (dryRun) {
    console.log("Would remove from global settings:");
    console.log("");
    console.log("  - MCP server: envshield");
    console.log("  - Deny rules: Read(.env*), Edit(.env*)");
    console.log("");
    console.log("Run without --dry-run to apply changes.");
    return;
  }

  // Remove envshield MCP server
  const { envshield, ...otherMcpServers } = existingSettings.mcpServers ?? {};
  const newSettings: ClaudeSettings = {
    ...existingSettings,
    mcpServers: Object.keys(otherMcpServers).length > 0 ? otherMcpServers : undefined,
  };

  // Remove deny rules (only if we added them and no other MCP needs them)
  const denyRules = ["Read(.env*)", "Edit(.env*)"];
  const existingDeny = existingSettings.deny ?? [];
  const newDeny = existingDeny.filter((rule) => !denyRules.includes(rule));
  newSettings.deny = newDeny.length > 0 ? newDeny : undefined;

  await saveSettings(settingsPath, newSettings);
  console.log(`Updated ${settingsPath}`);
  console.log("");
  console.log("Removed:");
  console.log("  - MCP server: envshield");
  console.log("  - Deny rules: Read(.env*), Edit(.env*)");
  console.log("");
  console.log("envshield has been removed from global configuration.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "init": {
      const global = args.includes("--global");
      const dryRun = args.includes("--dry-run");
      await init(global, dryRun);
      break;
    }

    case "uninit": {
      const dryRun = args.includes("--dry-run");
      await uninit(dryRun);
      break;
    }

    case "--version":
    case "-v":
      console.log(`envshield-mcp v${VERSION}`);
      break;

    case "--help":
    case "-h":
      console.log(`envshield-mcp v${VERSION}`);
      console.log("");
      console.log("Usage:");
      console.log("  envshield-mcp              Start MCP server (used by Claude/Cursor)");
      console.log("");
      console.log("Commands:");
      console.log("  envshield-mcp init         Configure envshield for current project");
      console.log("  envshield-mcp init --global    Configure envshield globally");
      console.log("  envshield-mcp init --dry-run   Show what would be configured");
      console.log("  envshield-mcp uninit       Remove global envshield configuration");
      console.log("  envshield-mcp uninit --dry-run  Show what would be removed");
      console.log("");
      console.log("Options:");
      console.log("  --global                  Apply configuration globally (default: project-local)");
      console.log("  --dry-run                 Show changes without applying them");
      console.log("");
      console.log("  --version                Show version");
      console.log("  --help                   Show this help");
      break;

    default:
      // Default: start MCP server
      await startMCPServer(cwd());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
