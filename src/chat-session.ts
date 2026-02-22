// src/chat-session.ts
import { GoogleGenAI } from "@google/genai";
import { MODELS, ModelKey, AspectRatio, Resolution } from "./types.js";

export interface ChatSessionConfig {
  model: ModelKey;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  useGoogleSearch?: boolean;
}

export class ChatSessionManager {
  private chat: any = null;
  private currentConfig: ChatSessionConfig | null = null;
  private genAI: GoogleGenAI;

  constructor(genAI: GoogleGenAI) {
    this.genAI = genAI;
  }

  getOrCreateChat(config: ChatSessionConfig): any {
    const configChanged =
      !this.currentConfig ||
      this.currentConfig.model !== config.model ||
      this.currentConfig.useGoogleSearch !== config.useGoogleSearch;

    if (configChanged || !this.chat) {
      this.chat = this.createChat(config);
      this.currentConfig = { ...config };
    }

    return this.chat;
  }

  private createChat(config: ChatSessionConfig): any {
    const modelId = MODELS[config.model];

    const chatConfig: any = {
      responseModalities: ["TEXT", "IMAGE"],
    };

    const imageConfig: any = {};
    if (config.aspectRatio) {
      imageConfig.aspectRatio = config.aspectRatio;
    }
    if (config.resolution && config.model === "pro") {
      imageConfig.imageSize = config.resolution;
    }
    if (Object.keys(imageConfig).length > 0) {
      chatConfig.imageConfig = imageConfig;
    }

    if (config.useGoogleSearch && config.model === "pro") {
      chatConfig.tools = [{ googleSearch: {} }];
    }

    return this.genAI.chats.create({
      model: modelId,
      config: chatConfig,
    });
  }

  async sendMessage(message: string, config?: ChatSessionConfig): Promise<any> {
    const chat = this.getOrCreateChat(config || this.currentConfig || { model: "flash" });
    return await chat.sendMessage({ message });
  }

  reset(): void {
    this.chat = null;
    this.currentConfig = null;
  }

  hasActiveSession(): boolean {
    return this.chat !== null;
  }
}
