import { App } from "@modelcontextprotocol/ext-apps";

// --- DOM refs ---
const img = document.getElementById("viewer-img") as HTMLImageElement;
const placeholder = document.getElementById("placeholder")!;
const metadataBar = document.getElementById("metadata")!;
const zoomLabel = document.getElementById("zoom-level")!;
const container = document.getElementById("image-container")!;

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

// --- Helpers ---

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

// --- Display image from tool result ---

function showImage(base64: string, mimeType: string) {
  imageDataUrl = `data:${mimeType};base64,${base64}`;
  img.src = imageDataUrl;
  img.classList.remove("hidden");
  placeholder.classList.add("hidden");
  fitToView();
}

function showMetadata(text: string) {
  // Parse the status text for key-value pairs
  const lines = text.split("\n").filter((l) => l.trim());
  const tags: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Extract metadata lines like "Prompt: ...", "Aspect ratio: ...", etc.
    if (trimmed.startsWith("Prompt:")) {
      const val = trimmed.slice(7).trim().replace(/^"|"$/g, "");
      tags.push(`<span class="tag"><strong>Prompt:</strong> ${escapeHtml(val)}</span>`);
    } else if (trimmed.startsWith("Aspect ratio:")) {
      tags.push(`<span class="tag"><strong>Aspect:</strong> ${escapeHtml(trimmed.slice(13).trim())}</span>`);
    } else if (trimmed.startsWith("Resolution:")) {
      tags.push(`<span class="tag"><strong>Res:</strong> ${escapeHtml(trimmed.slice(11).trim())}</span>`);
    } else if (trimmed.startsWith("Image generated with") || trimmed.startsWith("Image edited with") || trimmed.startsWith("Image updated with")) {
      // Extract model name from parentheses
      const match = trimmed.match(/\(([^)]+)\)/);
      if (match) {
        tags.push(`<span class="tag"><strong>Model:</strong> ${escapeHtml(match[1])}</span>`);
      }
    }
  }

  if (tags.length > 0) {
    metadataBar.innerHTML = tags.join("");
    metadataBar.classList.remove("hidden");
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// --- MCP App connection ---

const app = new App({ name: "Image Viewer", version: "1.0.0" });

app.ontoolresult = (result) => {
  if (result.isError) {
    placeholder.textContent = "Image generation failed.";
    return;
  }

  const content = result.content ?? [];

  // Find image content
  for (const item of content) {
    if ((item as any).type === "image" && (item as any).data) {
      showImage((item as any).data, (item as any).mimeType || "image/png");
    }
  }

  // Find text content for metadata
  for (const item of content) {
    if ((item as any).type === "text" && (item as any).text) {
      showMetadata((item as any).text);
    }
  }
};

app.connect();
