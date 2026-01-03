import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface EnvshieldConfig {
  envFiles: string[];
  redactMode: "placeholder" | "asterisk" | "partial";
  redactPatterns: string[];
  allowedCommands: string[] | null;
  blockedCommands: string[];
}

export const DEFAULT_CONFIG: EnvshieldConfig = {
  envFiles: [".env", ".env.local"],
  redactMode: "placeholder",
  redactPatterns: [],
  allowedCommands: null,
  blockedCommands: ["rm -rf", "sudo"],
};

export async function loadConfig(projectDir: string): Promise<EnvshieldConfig> {
  const globalPath = join(homedir(), ".envshield", "config.json");
  const localPath = join(projectDir, ".envshield.json");

  let config = { ...DEFAULT_CONFIG };

  // Load global config if exists
  if (existsSync(globalPath)) {
    try {
      const globalConfig = JSON.parse(await readFile(globalPath, "utf-8"));
      config = { ...config, ...globalConfig };
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  // Load local config if exists (overrides global)
  if (existsSync(localPath)) {
    try {
      const localConfig = JSON.parse(await readFile(localPath, "utf-8"));
      config = { ...config, ...localConfig };
    } catch {
      // Ignore parse errors
    }
  }

  return config;
}
