import { describe, it, expect } from "vitest";
import { Scrubber } from "../core/scrubber.js";

describe("Scrubber", () => {
  describe("scrubKnownSecrets", () => {
    it("replaces known secret values with placeholder", () => {
      const scrubber = new Scrubber("placeholder", []);
      const secrets = new Map([
        ["API_KEY", "sk_live_abc123"],
        ["DB_PASS", "supersecret"],
      ]);

      const result = scrubber.scrub(
        "Connected with sk_live_abc123, password supersecret",
        secrets
      );

      expect(result.text).toBe(
        "Connected with [REDACTED:API_KEY], password [REDACTED:DB_PASS]"
      );
      expect(result.redactedCount).toBe(2);
    });

    it("uses asterisk mode when configured", () => {
      const scrubber = new Scrubber("asterisk", []);
      const secrets = new Map([["API_KEY", "secret"]]);

      const result = scrubber.scrub("key is secret", secrets);

      expect(result.text).toBe("key is ******");
    });

    it("uses partial mode when configured", () => {
      const scrubber = new Scrubber("partial", []);
      const secrets = new Map([["API_KEY", "sk_live_abc123"]]);

      const result = scrubber.scrub("key: sk_live_abc123", secrets);

      expect(result.text).toBe("key: sk_***123");
    });
  });

  describe("pattern-based detection", () => {
    it("detects Stripe keys not in known secrets", () => {
      const scrubber = new Scrubber("placeholder", []);

      const result = scrubber.scrub(
        "Found key: sk_live_xyz789 in response",
        new Map()
      );

      expect(result.text).toBe(
        "Found key: [REDACTED:STRIPE_LIVE_KEY] in response"
      );
      expect(result.redactedCount).toBe(1);
    });

    it("detects GitHub PATs", () => {
      const scrubber = new Scrubber("placeholder", []);

      const result = scrubber.scrub("Token: ghp_abc123def456", new Map());

      expect(result.text).toBe("Token: [REDACTED:GITHUB_PAT]");
    });

    it("detects AWS access keys", () => {
      const scrubber = new Scrubber("placeholder", []);

      const result = scrubber.scrub("AWS key: AKIAIOSFODNN7EXAMPLE", new Map());

      expect(result.text).toBe("AWS key: [REDACTED:AWS_ACCESS_KEY]");
    });

    it("applies custom patterns", () => {
      const scrubber = new Scrubber("placeholder", ["mycompany_[a-z]+"]);

      const result = scrubber.scrub("Secret: mycompany_secretkey", new Map());

      expect(result.text).toBe("Secret: [REDACTED:CUSTOM_PATTERN]");
    });
  });
});
