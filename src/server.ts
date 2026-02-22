// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest,
  CallToolResult,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigManager } from "./config.js";
import { ChatSessionManager } from "./chat-session.js";

// Tool definitions & handlers
import { configureGeminiTokenTool, getConfigurationStatusTool, handleConfigureToken, handleGetConfigStatus } from "./tools/config-tools.js";
import { generateImageTool, handleGenerateImage } from "./tools/generate.js";
import { editImageTool, handleEditImage } from "./tools/edit.js";
import { continueEditingTool, handleContinueEditing } from "./tools/continue.js";
import { getLastImageInfoTool, handleGetLastImageInfo } from "./tools/info.js";

export class NanoBananaMCP {
  private server: Server;
  private configManager: ConfigManager;
  private chatSession: ChatSessionManager | null = null;
  private lastImagePath: string | null = null;

  constructor() {
    this.configManager = new ConfigManager();
    this.server = new Server(
      { name: "text2image-mcp", version: "2.0.0" },
      { capabilities: { tools: {} } },
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        configureGeminiTokenTool,
        getConfigurationStatusTool,
        generateImageTool,
        editImageTool,
        continueEditingTool,
        getLastImageInfoTool,
      ],
    }));

    // Call tools
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest): Promise<CallToolResult> => {
      try {
        return await this.routeToolCall(request);
      } catch (error) {
        if (error instanceof McpError) throw error;
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  private async routeToolCall(request: CallToolRequest): Promise<CallToolResult> {
    const { name } = request.params;

    // Config tools don't need API key
    if (name === "configure_gemini_token") {
      return handleConfigureToken(request, this.configManager);
    }
    if (name === "get_configuration_status") {
      return handleGetConfigStatus(this.configManager);
    }

    // All other tools need configured API
    if (!this.configManager.isConfigured()) {
      throw new McpError(ErrorCode.InvalidRequest, "Gemini API token not configured. Use configure_gemini_token first or set GEMINI_API_KEY env var.");
    }

    const genAI = this.configManager.genAI!;

    // Lazy-init chat session manager
    if (!this.chatSession) {
      this.chatSession = new ChatSessionManager(genAI);
    }

    switch (name) {
      case "generate_image": {
        const { result, savedPath } = await handleGenerateImage(request, genAI, this.chatSession);
        if (savedPath) this.lastImagePath = savedPath;
        return result;
      }

      case "edit_image": {
        const { result, savedPath } = await handleEditImage(request, genAI);
        if (savedPath) {
          this.lastImagePath = savedPath;
          this.chatSession.reset(); // New base image, reset chat context
        }
        return result;
      }

      case "continue_editing": {
        const { result, savedPath } = await handleContinueEditing(
          request, genAI, this.chatSession, this.lastImagePath,
        );
        if (savedPath) this.lastImagePath = savedPath;
        return result;
      }

      case "get_last_image_info":
        return handleGetLastImageInfo(this.lastImagePath);

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  }

  async run(): Promise<void> {
    await this.configManager.load();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
