import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createEnvshieldServer } from "./server.js";
import { Scrubber } from "../core/scrubber.js";
import { VERSION } from "../version.js";

export async function startMCPServer(projectDir: string): Promise<void> {
  const envshield = await createEnvshieldServer(projectDir);

  const server = new Server(
    {
      name: "envshield",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: envshield.getTools(),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await envshield.callTool(name, args ?? {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // Scrub error messages to prevent secret leakage
      const config = envshield.config;
      const scrubber = new Scrubber(config.redactMode, config.redactPatterns);
      const secretValues = envshield.secrets.values();

      const errorMsg = error instanceof Error ? error.message : String(error);
      const scrubbed = scrubber.scrub(errorMsg, secretValues);

      return {
        content: [
          {
            type: "text",
            text: `Error: ${scrubbed.text}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
