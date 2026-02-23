import { App } from "@modelcontextprotocol/ext-apps";

// --- DOM refs ---
const img = document.getElementById("viewer-img") as HTMLImageElement;
const placeholder = document.getElementById("placeholder")!;
const metadataBar = document.getElementById("metadata")!;
const zoomLabel = document.getElementById("zoom-level")!;
const container = document.getElementById("image-container")!;
const debugEl = document.getElementById("debug-info")!;

// --- State ---
let scale = 1;
let translateX = 0;
let translateY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let lastTranslateX = 0;
let lastTranslateY = 0;
let imageDataUrl = "";

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const ZOOM_STEP = 0.25;

// --- Transform helpers ---

function applyTransform() {
  img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
}

function fitToView() {
  scale = 1;
  translateX = 0;
  translateY = 0;
  img.style.maxWidth = "100%";
  img.style.maxHeight = "100%";
  applyTransform();
}

function actualSize() {
  img.style.maxWidth = "none";
  img.style.maxHeight = "none";
  scale = 1;
  translateX = 0;
  translateY = 0;
  applyTransform();
}

function zoomBy(delta: number) {
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + delta));
  applyTransform();
}

// --- Toolbar buttons ---
document.getElementById("btn-zoom-in")!.addEventListener("click", () => zoomBy(ZOOM_STEP));
document.getElementById("btn-zoom-out")!.addEventListener("click", () => zoomBy(-ZOOM_STEP));
document.getElementById("btn-fit")!.addEventListener("click", fitToView);
document.getElementById("btn-actual")!.addEventListener("click", actualSize);

document.getElementById("btn-download")!.addEventListener("click", () => {
  if (!imageDataUrl) return;
  const a = document.createElement("a");
  a.href = imageDataUrl;
  a.download = `nano-banana-${Date.now()}.png`;
  a.click();
});

// --- Pan via drag ---
container.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  lastTranslateX = translateX;
  lastTranslateY = translateY;
  container.classList.add("dragging");
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  translateX = lastTranslateX + (e.clientX - dragStartX);
  translateY = lastTranslateY + (e.clientY - dragStartY);
  applyTransform();
});

window.addEventListener("mouseup", () => {
  isDragging = false;
  container.classList.remove("dragging");
});

// --- Zoom via scroll ---
container.addEventListener("wheel", (e) => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
  zoomBy(delta);
}, { passive: false });

// --- Display helpers ---

function showImage(dataUrl: string) {
  imageDataUrl = dataUrl;
  img.src = dataUrl;
  img.classList.remove("hidden");
  placeholder.classList.add("hidden");
  fitToView();
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function showMetadata(text: string) {
  const lines = text.split("\n").filter((l) => l.trim());
  const tags: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("Prompt:") || t.startsWith("Edit prompt:")) {
      const val = t.replace(/^(Edit )?[Pp]rompt:\s*/, "").replace(/^"|"$/g, "");
      tags.push(`<span class="tag"><strong>Prompt:</strong> ${escapeHtml(val)}</span>`);
    } else if (t.startsWith("Aspect ratio:")) {
      tags.push(`<span class="tag"><strong>Aspect:</strong> ${escapeHtml(t.slice(13).trim())}</span>`);
    } else if (t.startsWith("Resolution:")) {
      tags.push(`<span class="tag"><strong>Res:</strong> ${escapeHtml(t.slice(11).trim())}</span>`);
    } else if (t.match(/^Image (generated|edited|updated) with/)) {
      const m = t.match(/\(([^)]+)\)/);
      if (m) tags.push(`<span class="tag"><strong>Model:</strong> ${escapeHtml(m[1])}</span>`);
    }
  }

  if (tags.length > 0) {
    metadataBar.innerHTML = tags.join("");
    metadataBar.classList.remove("hidden");
  }
}

// --- Try every possible way to extract image data from a content item ---

function tryExtractImage(item: any): string | null {
  // Standard MCP ImageContent: { type: "image", data: "base64", mimeType: "..." }
  if (item.data && typeof item.data === "string") {
    const mime = item.mimeType || item.mime_type || "image/png";
    return `data:${mime};base64,${item.data}`;
  }

  // Maybe base64 field?
  if (item.base64 && typeof item.base64 === "string") {
    const mime = item.mimeType || item.mime_type || "image/png";
    return `data:${mime};base64,${item.base64}`;
  }

  // Maybe blob URL?
  if (item.blob && typeof item.blob === "string") {
    return item.blob;
  }

  // Maybe url field?
  if (item.url && typeof item.url === "string") {
    return item.url;
  }

  // Maybe it's already a data URL in text?
  if (item.text && typeof item.text === "string" && item.text.startsWith("data:image/")) {
    return item.text;
  }

  return null;
}

// --- Debug: show what we received ---

function showDebug(result: any) {
  const content = result.content ?? [];
  const parts: string[] = [];

  parts.push(`content items: ${content.length}`);
  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    const keys = Object.keys(item);
    const type = item.type || "unknown";
    const dataLen = item.data ? `${String(item.data).length} chars` : "none";
    parts.push(`  [${i}] type=${type}, keys=[${keys.join(",")}], data=${dataLen}`);
  }

  if (result.structuredContent) {
    parts.push(`structuredContent: ${JSON.stringify(result.structuredContent).slice(0, 200)}`);
  }

  debugEl.textContent = parts.join("\n");
  debugEl.classList.remove("hidden");
}

// --- MCP App connection ---

const app = new App(
  { name: "Image Viewer", version: "1.0.0" },
  {},
  { autoResize: true },
);

app.ontoolresult = (result) => {
  if (result.isError) {
    placeholder.textContent = "Image generation failed.";
    return;
  }

  // Show debug info so we can see what's in the result
  showDebug(result);

  const content = result.content ?? [];
  let imageFound = false;

  // Try to find image in content items
  for (const item of content) {
    const dataUrl = tryExtractImage(item as any);
    if (dataUrl) {
      showImage(dataUrl);
      imageFound = true;
      break;
    }
  }

  // Also try structuredContent
  if (!imageFound && result.structuredContent) {
    const sc = result.structuredContent as any;
    // Maybe image is nested in structured content
    if (sc.data && sc.mimeType) {
      showImage(`data:${sc.mimeType};base64,${sc.data}`);
      imageFound = true;
    } else if (sc.image) {
      const dataUrl = tryExtractImage(sc.image);
      if (dataUrl) {
        showImage(dataUrl);
        imageFound = true;
      }
    }
  }

  if (!imageFound) {
    placeholder.textContent = "Image rendered natively above.";
  }

  // Show metadata from text content
  for (const item of content) {
    if ((item as any).type === "text" && (item as any).text) {
      showMetadata((item as any).text);
    }
  }
};

app.connect();
