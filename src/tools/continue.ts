// src/tools/continue.ts
import {
  CallToolRequest, CallToolResult, ErrorCode, McpError, Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from "@google/genai";
import { ASPECT_RATIOS, RESOLUTIONS, AspectRatio, Resolution } from "../types.js";
import { saveImageFromBase64, readImageAsBase64 } from "../image-utils.js";
import { ChatSessionManager } from "../chat-session.js";

export const continueEditingTool: Tool = {
  name: "continue_editing",
  description:
    "Continue editing the LAST generated/edited image using multi-turn conversation. The model remembers previous context. Supports reference images, aspect ratio, and resolution changes.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Text describing the changes to make to the last image",
      },
      referenceImages: {
        type: "array",
        items: { type: "string" },
        description: "Optional file paths to reference images for style/content guidance",
      },
      aspectRatio: {
        type: "string",
        enum: [...ASPECT_RATIOS],
        description: "Change the aspect ratio for this edit",
      },
      resolution: {
        type: "string",
        enum: [...RESOLUTIONS],
        description: "Change the resolution for this edit (Pro model only)",
      },
    },
    required: ["prompt"],
  },
};

export async function handleContinueEditing(
  request: CallToolRequest,
  genAI: GoogleGenAI,
  chatSession: ChatSessionManager,
  lastImagePath: string | null,
): Promise<{ result: CallToolResult; savedPath: string | null }> {
  if (!lastImagePath) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "No previous image found. Use generate_image or edit_image first.",
    );
  }

  const args = request.params.arguments as {
    prompt: string;
    referenceImages?: string[];
    aspectRatio?: AspectRatio;
    resolution?: Resolution;
  };

  // If no active chat session, fall back to re-sending the last image
  if (!chatSession.hasActiveSession()) {
    const mainImage = await readImageAsBase64(lastImagePath);
    const parts: any[] = [
      { inlineData: { data: mainImage.base64, mimeType: mainImage.mimeType } },
    ];

    if (args.referenceImages) {
      for (const refPath of args.referenceImages) {
        try {
          const refImg = await readImageAsBase64(refPath);
          parts.push({ inlineData: { data: refImg.base64, mimeType: refImg.mimeType } });
        } catch { /* skip */ }
      }
    }

    parts.push({ text: args.prompt });

    const config: any = { responseModalities: ["TEXT", "IMAGE"] };
    const imageConfig: any = {};
    if (args.aspectRatio) imageConfig.aspectRatio = args.aspectRatio;
    if (args.resolution) imageConfig.imageSize = args.resolution;
    if (Object.keys(imageConfig).length > 0) config.imageConfig = imageConfig;

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ parts }],
      config,
    });

    return processResponse(response, args);
  }

  // Active chat session exists — use it for true multi-turn
  const response = await chatSession.sendMessage(args.prompt);
  return processResponse(response, args);
}

async function processResponse(
  response: any,
  args: { prompt: string; aspectRatio?: string; resolution?: string },
): Promise<{ result: CallToolResult; savedPath: string | null }> {
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

  let statusText = `Image updated with nano-banana (continue_editing)`;
  statusText += `\n\nEdit prompt: "${args.prompt}"`;
  if (args.aspectRatio) statusText += `\nAspect ratio: ${args.aspectRatio}`;
  if (args.resolution) statusText += `\nResolution: ${args.resolution}`;
  if (textContent) statusText += `\n\nDescription: ${textContent}`;

  if (savedPath) {
    statusText += `\n\nEdited image saved to: ${savedPath}`;
    statusText += `\nUse continue_editing again for further changes.`;
  } else {
    statusText += `\n\nNo edited image generated. Try again.`;
  }

  content.unshift({ type: "text", text: statusText });
  return { result: { content }, savedPath };
}
