// src/tools/info.ts
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";

export const getLastImageInfoTool: Tool = {
  name: "get_last_image_info",
  description: "Get information about the last generated/edited image (file path, size, etc.)",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export async function handleGetLastImageInfo(
  lastImagePath: string | null,
): Promise<CallToolResult> {
  if (!lastImagePath) {
    return {
      content: [{
        type: "text",
        text: "No previous image found. Use generate_image or edit_image first.",
      }],
    };
  }

  try {
    const stats = await fs.stat(lastImagePath);
    return {
      content: [{
        type: "text",
        text: `Last Image:\n\nPath: ${lastImagePath}\nSize: ${Math.round(stats.size / 1024)} KB\nModified: ${stats.mtime.toLocaleString()}\n\nUse continue_editing to make changes.`,
      }],
    };
  } catch {
    return {
      content: [{
        type: "text",
        text: `Last Image:\n\nPath: ${lastImagePath}\nStatus: File not found (may have been moved or deleted)\n\nUse generate_image to create a new image.`,
      }],
    };
  }
}
