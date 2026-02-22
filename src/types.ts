// src/types.ts
import { z } from "zod";

// Model constants
export const MODELS = {
  flash: "gemini-2.5-flash-image",
  pro: "gemini-3-pro-image-preview",
} as const;

export type ModelKey = keyof typeof MODELS;

// Valid aspect ratios from Gemini API docs
export const ASPECT_RATIOS = [
  "1:1", "2:3", "3:2", "3:4", "4:3",
  "4:5", "5:4", "9:16", "16:9", "21:9",
] as const;

export type AspectRatio = typeof ASPECT_RATIOS[number];

// Valid resolutions (Pro model only)
export const RESOLUTIONS = ["1K", "2K", "4K"] as const;
export type Resolution = typeof RESOLUTIONS[number];

// Config schema
export const ConfigSchema = z.object({
  geminiApiKey: z.string().min(1, "Gemini API key is required"),
});

export type Config = z.infer<typeof ConfigSchema>;

// Shared tool parameter types
export interface ImageGenOptions {
  model?: ModelKey;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  useGoogleSearch?: boolean;
}
