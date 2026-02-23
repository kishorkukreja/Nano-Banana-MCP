import { App } from "@modelcontextprotocol/ext-apps";

// --- DOM refs ---
const placeholder = document.getElementById("placeholder")!;
const contentEl = document.getElementById("content")!;
const headerTitle = document.getElementById("header-title")!;
const headerSubtitle = document.getElementById("header-subtitle")!;
const statusBadge = document.getElementById("status-badge")!;
const infoGrid = document.getElementById("info-grid")!;
const filePathEl = document.getElementById("file-path")!;
const filePathValue = document.getElementById("file-path-value")!;

// --- Helpers ---

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function addInfoCard(label: string, value: string, fullWidth = false, accent = false) {
  const card = document.createElement("div");
  card.className = `info-card${fullWidth ? " full-width" : ""}`;
  card.innerHTML = `
    <div class="label">${escapeHtml(label)}</div>
    <div class="value${accent ? " accent" : ""}">${escapeHtml(value)}</div>
  `;
  infoGrid.appendChild(card);
}

function parseAndDisplay(text: string) {
  const lines = text.split("\n").filter((l) => l.trim());

  let model = "";
  let prompt = "";
  let aspect = "";
  let resolution = "";
  let search = false;
  let description = "";
  let savedPath = "";
  let action = "Generated"; // default

  for (const line of lines) {
    const t = line.trim();

    if (t.startsWith("Image generated with")) {
      action = "Generated";
      const m = t.match(/\(([^)]+)\)/);
      if (m) model = m[1];
    } else if (t.startsWith("Image edited with")) {
      action = "Edited";
      const m = t.match(/\(([^)]+)\)/);
      if (m) model = m[1];
    } else if (t.startsWith("Image updated with")) {
      action = "Updated";
      const m = t.match(/\(([^)]+)\)/);
      if (m) model = m[1];
    } else if (t.startsWith("Prompt:") || t.startsWith("Edit prompt:")) {
      prompt = t.replace(/^(Edit )?[Pp]rompt:\s*/, "").replace(/^"|"$/g, "");
    } else if (t.startsWith("Aspect ratio:")) {
      aspect = t.slice(13).trim();
    } else if (t.startsWith("Resolution:")) {
      resolution = t.slice(11).trim();
    } else if (t.startsWith("Google Search grounding:")) {
      search = t.includes("enabled");
    } else if (t.startsWith("Description:")) {
      description = t.slice(12).trim();
    } else if (t.startsWith("Image saved to:") || t.startsWith("Edited image saved to:")) {
      savedPath = t.replace(/^.*saved to:\s*/, "").trim();
    }
  }

  // Header
  headerTitle.textContent = `nano-banana`;
  headerSubtitle.textContent = model || "Gemini";
  statusBadge.textContent = action;

  // Info cards
  if (prompt) addInfoCard("Prompt", prompt, true);
  if (model) addInfoCard("Model", model, false, true);
  if (aspect) addInfoCard("Aspect Ratio", aspect);
  if (resolution) addInfoCard("Resolution", resolution);
  if (search) addInfoCard("Search Grounding", "Enabled");
  if (description) addInfoCard("Description", description, true);

  // File path
  if (savedPath) {
    filePathValue.textContent = savedPath;
    filePathEl.classList.remove("hidden");
  }

  // Show content, hide placeholder
  placeholder.classList.add("hidden");
  contentEl.classList.remove("hidden");
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

  const content = result.content ?? [];

  // Find text content for metadata display
  for (const item of content) {
    if ((item as any).type === "text" && (item as any).text) {
      parseAndDisplay((item as any).text);
      return;
    }
  }

  // Fallback if no text content
  placeholder.textContent = "No metadata available.";
};

app.connect();
