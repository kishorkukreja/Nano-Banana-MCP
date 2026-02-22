// src/tools/edit.ts
import {
  CallToolRequest, CallToolResult, Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from "@google/genai";
import { MODELS, ASPECT_RATIOS, RESOLUTIONS, ModelKey, AspectRatio, Resolution } from "../types.js";
import { saveImageFromBase64, readImageAsBase64 } from "../image-utils.js";

export const editImageTool: Tool = {
  name: "edit_image",
  description:
    "Edit a SPECIFIC existing image file with text prompts. Supports optional reference images, model selection, aspect ratios, and resolution.",
  inputSchema: {
    type: "object",
    properties: {
      imagePath: {
        type: "string",
        description: "Full file path to the image to edit",
      },
      prompt: {
        type: "string",
        description: "Text describing the modifications to make",
      },
      referenceImages: {
        type: "array",
        items: { type: "string" },
        description: "Optional file paths to reference images (up to 3 for Flash, up to 14 for Pro)",
      },
      model: {
        type: "string",
        enum: ["flash", "pro"],
        description: "Model to use. 'flash' (default) for speed. 'pro' for quality and more reference images.",
      },
      aspectRatio: {
        type: "string",
        enum: [...ASPECT_RATIOS],
        description: "Aspect ratio for the output image",
      },
      resolution: {
        type: "string",
        enum: [...RESOLUTIONS],
        description: "Image resolution (Pro model only): '1K', '2K', '4K'",
      },
    },
    required: ["imagePath", "prompt"],
  },
};

export async function handleEditImage(
  request: CallToolRequest,
  genAI: GoogleGenAI,
): Promise<{ result: CallToolResult; savedPath: string | null }> {
  const args = request.params.arguments as {
    imagePath: string;
    prompt: string;
    referenceImages?: string[];
    model?: ModelKey;
    aspectRatio?: AspectRatio;
    resolution?: Resolution;
  };

  let model: ModelKey = args.model || "flash";
  // Auto-upgrade to Pro if many reference images or Pro-only features
  if ((args.referenceImages && args.referenceImages.length > 3) ||
      args.resolution === "2K" || args.resolution === "4K") {
    model = "pro";
  }

  const modelId = MODELS[model];

  // Build image parts
  const mainImage = await readImageAsBase64(args.imagePath);
  const parts: any[] = [
    { inlineData: { data: mainImage.base64, mimeType: mainImage.mimeType } },
  ];

  // Add reference images
  if (args.referenceImages) {
    for (const refPath of args.referenceImages) {
      try {
        const refImg = await readImageAsBase64(refPath);
        parts.push({ inlineData: { data: refImg.base64, mimeType: refImg.mimeType } });
      } catch {
        // Skip unreadable reference images
      }
    }
  }

  parts.push({ text: args.prompt });

  // Build config
  const config: any = {
    responseModalities: ["TEXT", "IMAGE"],
  };
  const imageConfig: any = {};
  if (args.aspectRatio) imageConfig.aspectRatio = args.aspectRatio;
  if (args.resolution && model === "pro") imageConfig.imageSize = args.resolution;
  if (Object.keys(imageConfig).length > 0) config.imageConfig = imageConfig;

  const response = await genAI.models.generateContent({
    model: modelId,
    contents: [{ parts }],
    config,
  });

  // Process response
  const content: any[] = [];
  let savedPath: string | null = null;
  let textContent = "";

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.text && !part.thought) textContent += part.text;
      if (part.inlineData?.data && !part.thought) {
        const saved = await saveImageFromBase64(part.inlineData.data, "edited");
        savedPath = saved.filePath;
        content.push({
          type: "image",
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        });
      }
    }
  }

  let statusText = `Image edited with nano-banana (${model === "pro" ? "Gemini 3 Pro" : "Gemini 2.5 Flash"})`;
  statusText += `\n\nOriginal: ${args.imagePath}`;
  statusText += `\nEdit prompt: "${args.prompt}"`;
  if (args.referenceImages?.length) {
    statusText += `\nReference images: ${args.referenceImages.length}`;
  }
  if (args.aspectRatio) statusText += `\nAspect ratio: ${args.aspectRatio}`;
  if (textContent) statusText += `\n\nDescription: ${textContent}`;

  if (savedPath) {
    statusText += `\n\nEdited image saved to: ${savedPath}`;
    statusText += `\nUse continue_editing to make further changes.`;
  } else {
    statusText += `\n\nNo edited image generated. Try again.`;
  }

  content.unshift({ type: "text", text: statusText });

  return { result: { content }, savedPath };
}
