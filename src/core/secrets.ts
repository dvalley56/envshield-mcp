import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { parse } from "dotenv";

interface SecretEntry {
  value: string;
  sources: string[];
  activeSource: string;
}

export class SecretStore {
  private secrets: Map<string, SecretEntry> = new Map();

  set(name: string, value: string, source: string): void {
    const existing = this.secrets.get(name);
    if (existing) {
      existing.value = value;
      existing.sources.push(source);
      existing.activeSource = source;
    } else {
      this.secrets.set(name, {
        value,
        sources: [source],
        activeSource: source,
      });
    }
  }

  get(name: string): string | undefined {
    return this.secrets.get(name)?.value;
  }

  has(name: string): boolean {
    return this.secrets.has(name);
  }

  names(): string[] {
    return Array.from(this.secrets.keys());
  }

  sources(name: string): string[] {
    return this.secrets.get(name)?.sources ?? [];
  }

  activeSource(name: string): string | undefined {
    return this.secrets.get(name)?.activeSource;
  }

  values(): Map<string, string> {
    const result = new Map<string, string>();
    for (const [name, entry] of this.secrets) {
      result.set(name, entry.value);
    }
    return result;
  }

  allValues(): string[] {
    return Array.from(this.secrets.values()).map((e) => e.value);
  }
}

export async function loadSecrets(
  projectDir: string,
  envFiles: string[]
): Promise<SecretStore> {
  const store = new SecretStore();

  for (const envFile of envFiles) {
    const filePath = join(projectDir, envFile);
    if (!existsSync(filePath)) continue;

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parse(content);

      for (const [key, value] of Object.entries(parsed)) {
        if (value !== undefined) {
          store.set(key, value, envFile);
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return store;
}
