export type RedactMode = "placeholder" | "asterisk" | "partial";

export interface ScrubResult {
  text: string;
  redactedCount: number;
}

/**
 * Validates a regex pattern to prevent ReDoS (Regular Expression Denial of Service).
 * Tests the pattern against inputs that could cause catastrophic backtracking.
 */
function validateRegexPattern(pattern: string): void {
  const maxDuration = 10; // ms - very aggressive to prevent long hangs

  // Test with potentially problematic inputs
  const testCases = [
    "",
    "a",
    "a".repeat(10),
    "a".repeat(50),  // Reduced from 100 for faster testing
    "aaaaaaaaaaaaaaaaaaaaaab",  // Classic backtracking trigger
  ];

  // Use AbortController with setTimeout for early timeout
  const controller = new AbortController();
  const signal = controller.signal;

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, maxDuration);

  try {
    for (const test of testCases) {
      const start = Date.now();

      // Check if aborted (timeout exceeded)
      if (signal.aborted) {
        throw new Error(
          `Regex pattern rejected due to potential catastrophic backtracking: ${pattern}`
        );
      }

      try {
        const regex = new RegExp(pattern, "g");
        regex.test(test);
        const duration = Date.now() - start;

        if (duration > maxDuration) {
          throw new Error(
            `Regex pattern rejected due to potential catastrophic backtracking: ${pattern}`
          );
        }
      } catch (err) {
        if (err instanceof Error) {
          if (err.message.includes("catastrophic backtracking") || err.message.includes("rejected")) {
            throw err;
          }
          // Invalid regex
          throw new Error(`Invalid regex pattern: ${pattern} - ${err.message}`);
        }
        throw err;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export class Scrubber {
  private mode: RedactMode;
  private customPatterns: RegExp[];
  private builtinPatterns: Array<{ pattern: RegExp; name: string }>;

  constructor(mode: RedactMode, customPatterns: string[]) {
    this.mode = mode;
    // Validate custom patterns to prevent ReDoS
    this.customPatterns = customPatterns.map((p) => {
      validateRegexPattern(p);
      return new RegExp(p, "g");
    });
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
