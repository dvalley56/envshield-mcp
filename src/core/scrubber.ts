export type RedactMode = "placeholder" | "asterisk" | "partial";

export interface ScrubResult {
  text: string;
  redactedCount: number;
}

export class Scrubber {
  private mode: RedactMode;
  private customPatterns: RegExp[];
  private builtinPatterns: Array<{ pattern: RegExp; name: string }>;

  constructor(mode: RedactMode, customPatterns: string[]) {
    this.mode = mode;
    this.customPatterns = customPatterns.map((p) => new RegExp(p, "g"));
    this.builtinPatterns = [
      { pattern: /sk_live_[a-zA-Z0-9]+/g, name: "STRIPE_LIVE_KEY" },
      { pattern: /sk_test_[a-zA-Z0-9]+/g, name: "STRIPE_TEST_KEY" },
      { pattern: /pk_live_[a-zA-Z0-9]+/g, name: "STRIPE_PK_LIVE" },
      { pattern: /pk_test_[a-zA-Z0-9]+/g, name: "STRIPE_PK_TEST" },
      { pattern: /ghp_[a-zA-Z0-9]+/g, name: "GITHUB_PAT" },
      { pattern: /gho_[a-zA-Z0-9]+/g, name: "GITHUB_OAUTH" },
      { pattern: /ghu_[a-zA-Z0-9]+/g, name: "GITHUB_USER" },
      { pattern: /AKIA[A-Z0-9]{16}/g, name: "AWS_ACCESS_KEY" },
      { pattern: /sk-[a-zA-Z0-9]{48}/g, name: "OPENAI_KEY" },
      { pattern: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, name: "JWT" },
    ];
  }

  scrub(text: string, knownSecrets: Map<string, string>): ScrubResult {
    let result = text;
    let redactedCount = 0;

    // First, scrub known secrets
    for (const [name, value] of knownSecrets) {
      if (value && result.includes(value)) {
        const replacement = this.redact(value, name);
        result = result.split(value).join(replacement);
        redactedCount++;
      }
    }

    // Then, scrub pattern-based secrets
    for (const { pattern, name } of this.builtinPatterns) {
      const matches = result.match(pattern);
      if (matches) {
        for (const match of matches) {
          const replacement = this.redact(match, name);
          result = result.split(match).join(replacement);
          redactedCount++;
        }
      }
    }

    // Finally, scrub custom patterns
    for (const pattern of this.customPatterns) {
      const matches = result.match(pattern);
      if (matches) {
        for (const match of matches) {
          const replacement = this.redact(match, "CUSTOM_PATTERN");
          result = result.split(match).join(replacement);
          redactedCount++;
        }
      }
    }

    return { text: result, redactedCount };
  }

  private redact(value: string, name: string): string {
    switch (this.mode) {
      case "placeholder":
        return `[REDACTED:${name}]`;
      case "asterisk":
        return "*".repeat(value.length);
      case "partial":
        if (value.length <= 6) return "*".repeat(value.length);
        return value.slice(0, 3) + "***" + value.slice(-3);
    }
  }
}
