// src/config.ts
import { GoogleGenAI } from "@google/genai";
import { config as dotenvConfig } from "dotenv";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { Config, ConfigSchema } from "./types.js";

dotenvConfig();

export type ConfigSource = "environment" | "config_file" | "not_configured";

export class ConfigManager {
  config: Config | null = null;
  genAI: GoogleGenAI | null = null;
  configSource: ConfigSource = "not_configured";

  isConfigured(): boolean {
    return this.config !== null && this.genAI !== null;
  }

  async load(): Promise<void> {
    // Priority 1: Environment variable
    const envApiKey = process.env.GEMINI_API_KEY;
    if (envApiKey) {
      try {
        this.config = ConfigSchema.parse({ geminiApiKey: envApiKey });
        this.genAI = new GoogleGenAI({ apiKey: this.config.geminiApiKey });
        this.configSource = "environment";
        return;
      } catch {
        // Invalid key, fall through
      }
    }

    // Priority 2: Config file
    try {
      const configPath = path.join(process.cwd(), ".nano-banana-config.json");
      const configData = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(configData);
      this.config = ConfigSchema.parse(parsed);
      this.genAI = new GoogleGenAI({ apiKey: this.config.geminiApiKey });
      this.configSource = "config_file";
    } catch {
      this.configSource = "not_configured";
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    ConfigSchema.parse({ geminiApiKey: apiKey });
    this.config = { geminiApiKey: apiKey };
    this.genAI = new GoogleGenAI({ apiKey });
    this.configSource = "config_file";
    await this.save();
  }

  private async save(): Promise<void> {
    if (this.config) {
      const configPath = path.join(process.cwd(), ".nano-banana-config.json");
      await fs.writeFile(configPath, JSON.stringify(this.config, null, 2));
    }
  }
}
