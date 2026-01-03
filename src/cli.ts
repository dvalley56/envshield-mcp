#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { startMCPServer } from "./mcp/mcp.js";
import { VERSION } from "./version.js";

const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

interface ClaudeSettings {
  mcpServers?: Record<string, { command: string; args: string[] }>;
  deny?: string[];
  [key: string]: unknown;
}

async function loadClaudeSettings(): Promise<ClaudeSettings> {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) {
    return {};
  }
  const content = await readFile(CLAUDE_SETTINGS_PATH, "utf-8");
  return JSON.parse(content);
}

async function saveClaudeSettings(settings: ClaudeSettings): Promise<void> {
  const dir = join(homedir(), ".claude");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

async function init(dryRun: boolean): Promise<void> {
  console.log("envshield init" + (dryRun ? " (dry-run)" : ""));
  console.log("");

  const settings = await loadClaudeSettings();

  // Prepare new settings
  const newSettings: ClaudeSettings = { ...settings };

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
    console.log("Would update ~/.claude/settings.json:");
    console.log("");
    console.log(JSON.stringify(newSettings, null, 2));
    console.log("");
    console.log("Run without --dry-run to apply changes.");
  } else {
    await saveClaudeSettings(newSettings);
    console.log("Updated ~/.claude/settings.json");
    console.log("");
    console.log("Added:");
    console.log("  - MCP server: envshield");
    console.log("  - Deny rules: Read(.env*), Edit(.env*)");
    console.log("");
    console.log("envshield is now active. AI agents can use secrets without seeing them.");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "init":
      const dryRun = args.includes("--dry-run");
      await init(dryRun);
      break;

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
      console.log("  envshield-mcp init         Configure Claude Code to use envshield");
      console.log("  envshield-mcp init --dry-run  Show what would be configured");
      console.log("  envshield-mcp --version    Show version");
      console.log("  envshield-mcp --help       Show this help");
      break;

    default:
      // Default: start MCP server
      await startMCPServer(process.cwd());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
