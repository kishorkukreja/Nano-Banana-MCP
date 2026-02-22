// src/image-utils.ts
import fs from "fs/promises";
import path from "path";
import os from "os";

export function getImagesDirectory(): string {
  const platform = os.platform();

  if (platform === "win32") {
    return path.join(os.homedir(), "Documents", "nano-banana-images");
  }

  const cwd = process.cwd();
  if (cwd.startsWith("/usr/") || cwd.startsWith("/opt/") || cwd.startsWith("/var/")) {
    return path.join(os.homedir(), "nano-banana-images");
  }

  return path.join(cwd, "generated_imgs");
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

export interface SavedImage {
  filePath: string;
  sizeBytes: number;
}

export async function saveImageFromBase64(
  base64Data: string,
  prefix: "generated" | "edited",
): Promise<SavedImage> {
  const imagesDir = getImagesDirectory();
  await fs.mkdir(imagesDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const randomId = Math.random().toString(36).substring(2, 8);
  const fileName = `${prefix}-${timestamp}-${randomId}.png`;
  const filePath = path.join(imagesDir, fileName);

  const buffer = Buffer.from(base64Data, "base64");
  await fs.writeFile(filePath, buffer);

  return { filePath, sizeBytes: buffer.length };
}

export async function readImageAsBase64(imagePath: string): Promise<{
  base64: string;
  mimeType: string;
}> {
  const buffer = await fs.readFile(imagePath);
  return {
    base64: buffer.toString("base64"),
    mimeType: getMimeType(imagePath),
  };
}
