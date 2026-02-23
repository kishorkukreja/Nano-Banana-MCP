// src/tools/generate.ts
import {
  CallToolRequest, CallToolResult, Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from "@google/genai";
import { MODELS, ASPECT_RATIOS, RESOLUTIONS, ModelKey, AspectRatio, Resolution } from "../types.js";
import { saveImageFromBase64 } from "../image-utils.js";
import { ChatSessionManager } from "../chat-session.js";

const IMAGE_VIEWER_RESOURCE_URI = "ui://text2image/image-viewer.html";

export const generateImageTool: Tool = {
  name: "generate_image",
  description:
    "Generate a NEW image from a text prompt. Supports model selection, aspect ratios, and resolution control. Use 'pro' model for higher quality, 4K resolution, and Google Search grounding.",
  _meta: {
    ui: { resourceUri: IMAGE_VIEWER_RESOURCE_URI },
  },
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Text prompt describing the image to create",
      },
      model: {
        type: "string",
        enum: ["flash", "pro"],
        description: "Model to use. 'flash' (default) = fast/efficient. 'pro' = higher quality, supports 4K and search grounding.",
      },
      aspectRatio: {
        type: "string",
        enum: [...ASPECT_RATIOS],
        description: "Aspect ratio for the output image. Defaults to 1:1.",
      },
      resolution: {
        type: "string",
        enum: [...RESOLUTIONS],
        description: "Image resolution (Pro model only). '1K' (default), '2K', or '4K'.",
      },
      useGoogleSearch: {
        type: "boolean",
        description: "Enable Google Search grounding for real-time data (Pro model only). Useful for weather, news, charts.",
      },
    },
    required: ["prompt"],
  },
};

export async function handleGenerateImage(
  request: CallToolRequest,
  genAI: GoogleGenAI,
  chatSession: ChatSessionManager,
): Promise<{ result: CallToolResult; savedPath: string | null }> {
  const args = request.params.arguments as {
    prompt: string;
    model?: ModelKey;
    aspectRatio?: AspectRatio;
    resolution?: Resolution;
    useGoogleSearch?: boolean;
  };

  // Auto-select Pro if Pro-only features are requested
  let model: ModelKey = args.model || "flash";
  if ((args.resolution === "2K" || args.resolution === "4K" || args.useGoogleSearch) && model === "flash") {
    model = "pro";
  }

  const modelId = MODELS[model];

  // Build config
  const config: any = {
    responseModalities: ["TEXT", "IMAGE"],
  };

  const imageConfig: any = {};
  if (args.aspectRatio) imageConfig.aspectRatio = args.aspectRatio;
  if (args.resolution && model === "pro") imageConfig.imageSize = args.resolution;
  if (Object.keys(imageConfig).length > 0) config.imageConfig = imageConfig;

  if (args.useGoogleSearch && model === "pro") {
    config.tools = [{ googleSearch: {} }];
  }

  // Reset chat session (new generation = fresh context)
  chatSession.reset();

  const response = await genAI.models.generateContent({
    model: modelId,
    contents: args.prompt,
    config,
  });

  // Process response
  const content: any[] = [];
  let savedPath: string | null = null;
  let textContent = "";

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.text && !part.thought) {
        textContent += part.text;
      }
      if (part.inlineData?.data && !part.thought) {
        const saved = await saveImageFromBase64(part.inlineData.data, "generated");
        savedPath = saved.filePath;

        content.push({
          type: "image",
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        });
      }
    }
  }

  // Build status text
  let statusText = `Image generated with nano-banana (${model === "pro" ? "Gemini 3 Pro" : "Gemini 2.5 Flash"})`;
  statusText += `\n\nPrompt: "${args.prompt}"`;
  if (args.aspectRatio) statusText += `\nAspect ratio: ${args.aspectRatio}`;
  if (args.resolution && model === "pro") statusText += `\nResolution: ${args.resolution}`;
  if (args.useGoogleSearch) statusText += `\nGoogle Search grounding: enabled`;
  if (textContent) statusText += `\n\nDescription: ${textContent}`;

  if (savedPath) {
    statusText += `\n\nImage saved to: ${savedPath}`;
    statusText += `\n\nUse continue_editing to modify this image.`;
  } else {
    statusText += `\n\nNo image was generated. Try running again.`;
  }

  content.unshift({ type: "text", text: statusText });

  return { result: { content }, savedPath };
}
