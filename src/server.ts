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
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigManager } from "./config.js";
import { ChatSessionManager } from "./chat-session.js";

// Tool definitions & handlers
import { configureGeminiTokenTool, getConfigurationStatusTool, handleConfigureToken, handleGetConfigStatus } from "./tools/config-tools.js";
import { generateImageTool, handleGenerateImage } from "./tools/generate.js";
import { editImageTool, handleEditImage } from "./tools/edit.js";
import { continueEditingTool, handleContinueEditing } from "./tools/continue.js";
import { getLastImageInfoTool, handleGetLastImageInfo } from "./tools/info.js";

export interface NanoBananaMCPOptions {
  apiKey?: string;
  isRemote?: boolean;
}

export class NanoBananaMCP {
  private server: Server;
  private configManager: ConfigManager;
  private chatSession: ChatSessionManager | null = null;
  private lastImagePath: string | null = null;
  private isRemote: boolean;
  private injectedApiKey: string | undefined;

  constructor(options?: NanoBananaMCPOptions) {
    this.isRemote = options?.isRemote ?? false;
    this.injectedApiKey = options?.apiKey;
    this.configManager = new ConfigManager();
    this.server = new Server(
      { name: "text2image-mcp", version: "2.1.0" },
      { capabilities: { tools: {} } },
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools — exclude config tools in remote mode
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [
        generateImageTool,
        editImageTool,
        continueEditingTool,
        getLastImageInfoTool,
      ];

      if (!this.isRemote) {
        tools.unshift(configureGeminiTokenTool, getConfigurationStatusTool);
      }

      return { tools };
    });

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

    // Config tools don't need API key (local mode only)
    if (!this.isRemote) {
      if (name === "configure_gemini_token") {
        return handleConfigureToken(request, this.configManager);
      }
      if (name === "get_configuration_status") {
        return handleGetConfigStatus(this.configManager);
      }
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

  async connectTransport(transport: Transport): Promise<void> {
    if (this.injectedApiKey) {
      this.configManager.configureFromKey(this.injectedApiKey);
    } else {
      await this.configManager.load();
    }
    await this.server.connect(transport);
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.connectTransport(transport);
  }
}
