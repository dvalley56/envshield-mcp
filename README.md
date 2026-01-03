# envshield-mcp

MCP server that lets AI coding assistants use secrets without ever seeing them.

## Problem

AI coding assistants (Claude Code, Cursor, Copilot) automatically read `.env` files for context. This means your API keys, database credentials, and tokens can leak into AI context.

## Solution

envshield provides an execution-only access model. AI requests commands to run with secrets, envshield injects the real values, executes the command, and returns output with all secrets scrubbed.

**AI never sees your actual secret values.**

## Quick Start

```bash
npx envshield-mcp init
```

Done. Your AI assistant can now use secrets safely.

## How It Works

```
Before:  AI reads .env directly → secrets in context 
After:   AI uses envshield MCP → executes with secrets → scrubbed output ✓
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_secrets` | Returns secret names (never values) |
| `check_secret_exists` | Checks if a secret is defined |
| `run_with_secrets` | Executes command with secrets injected |

### Example

```
AI: "Test if the Stripe API key works"

AI calls: run_with_secrets({
  command: "curl -H 'Authorization: Bearer $STRIPE_KEY' https://api.stripe.com/v1/balance",
  secrets: ["STRIPE_KEY"]
})

AI receives: { exitCode: 0, stdout: "Balance: $1,234.56" }
(actual key never exposed)
```

## Configuration

Create `.envshield.json` in your project:

```json
{
  "envFiles": [".env", ".env.local"],
  "redactMode": "placeholder",
  "redactPatterns": ["mycompany_.*"],
  "blockedCommands": ["rm -rf", "sudo"]
}
```

## Scrubbing

envshield scrubs secrets from command output:

1. **Known secrets** - All values from your `.env` files
2. **Pattern detection** - Common formats (Stripe, GitHub, AWS, JWT, etc.)
3. **Custom patterns** - Your own regex patterns

## Manual Setup

If you prefer manual configuration, add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "envshield": {
      "command": "npx",
      "args": ["envshield-mcp"]
    }
  },
  "deny": ["Read(.env*)", "Edit(.env*)"]
}
```

## License

MIT
