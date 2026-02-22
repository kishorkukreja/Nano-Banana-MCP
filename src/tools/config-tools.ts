// src/tools/config-tools.ts
import { CallToolRequest, CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ConfigManager } from "../config.js";

export const configureGeminiTokenTool: Tool = {
  name: "configure_gemini_token",
  description: "Configure your Gemini API token for nano-banana image generation",
  inputSchema: {
    type: "object",
    properties: {
      apiKey: {
        type: "string",
        description: "Your Gemini API key from Google AI Studio",
      },
    },
    required: ["apiKey"],
  },
};

export const getConfigurationStatusTool: Tool = {
  name: "get_configuration_status",
  description: "Check if Gemini API token is configured",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export async function handleConfigureToken(
  request: CallToolRequest,
  configManager: ConfigManager,
): Promise<CallToolResult> {
  const { apiKey } = request.params.arguments as { apiKey: string };
  await configManager.setApiKey(apiKey);

  return {
    content: [{
      type: "text",
      text: "Gemini API token configured successfully. You can now use nano-banana image generation features.",
    }],
  };
}

export async function handleGetConfigStatus(
  configManager: ConfigManager,
): Promise<CallToolResult> {
  const isConfigured = configManager.isConfigured();

  let statusText: string;
  if (isConfigured) {
    const sourceLabel = configManager.configSource === "environment"
      ? "Environment variable (GEMINI_API_KEY)"
      : "Local configuration file (.nano-banana-config.json)";
    statusText = `Gemini API token is configured and ready.\nSource: ${sourceLabel}`;
  } else {
    statusText = `Gemini API token is not configured.\n\nConfiguration options (priority order):\n1. MCP client env: "env": { "GEMINI_API_KEY": "your-key" }\n2. System env: export GEMINI_API_KEY="your-key"\n3. Use configure_gemini_token tool`;
  }

  return { content: [{ type: "text", text: statusText }] };
}
