import JSZip from "jszip";
import { migratePackage } from "./migrate";

// --- build metadata footer ---
{
  const el = document.getElementById("commit-sha");
  const link = document.getElementById("commit-link") as HTMLAnchorElement | null;
  if (el) el.textContent = __COMMIT_SHA__;
  if (link && __COMMIT_SHA_FULL__) {
    link.href = `https://github.com/KostaGorod/ts4-toolbox/commit/${__COMMIT_SHA_FULL__}`;
  }
}

// --- DOM references ---
const dropZone = document.getElementById("drop") as HTMLElement;
const dropMessage = document.getElementById("drop-message") as HTMLParagraphElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const pickButton = document.getElementById("pick") as HTMLButtonElement;
const templateInput = document.getElementById("template-input") as HTMLInputElement;
const scaleInput = document.getElementById("scale-input") as HTMLInputElement;

const queuePane = document.getElementById("queue-pane") as HTMLElement;
const queueSummary = document.getElementById("queue-summary") as HTMLElement;
const fileQueueEl = document.getElementById("file-queue") as HTMLUListElement;
const startButton = document.getElementById("start") as HTMLButtonElement;
const clearButton = document.getElementById("clear") as HTMLButtonElement;
const downloadZipBtn = document.getElementById("download-zip") as HTMLButtonElement;

// --- state ---
type FileState = "queued" | "running" | "done" | "error";

interface QueuedFile {
  id: string;
  file: File;
  state: FileState;
  errorMessage?: string;
  result?: { outputName: string; bytes: Uint8Array };
  card: HTMLLIElement;
  pill: HTMLSpanElement;
  retryBtn: HTMLButtonElement;
  removeBtn: HTMLButtonElement;
}

const queue: QueuedFile[] = [];
let running = false;
const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const CONCURRENCY = 4;
const PACKAGE_EXT = ".package";

// --- template loading (unchanged semantics) ---
let bundledTemplate: Uint8Array | null = null;
async function loadBundledTemplate(): Promise<Uint8Array> {
  if (bundledTemplate) return bundledTemplate;
  const resp = await fetch("./empty-new.gfx");
  if (!resp.ok) throw new Error(`failed to fetch bundled template: ${resp.status}`);
  bundledTemplate = new Uint8Array(await resp.arrayBuffer());
  return bundledTemplate;
}
async function activeTemplate(): Promise<Uint8Array> {
  const override = templateInput.files?.[0];
  if (override) return new Uint8Array(await override.arrayBuffer());
  return loadBundledTemplate();
}

// --- helpers ---
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

let dropMessageTimer: number | undefined;
function flashDropMessage(text: string): void {
  dropMessage.textContent = text;
  dropMessage.hidden = false;
  if (dropMessageTimer !== undefined) window.clearTimeout(dropMessageTimer);
  dropMessageTimer = window.setTimeout(() => {
    dropMessage.hidden = true;
  }, 4500);
}

function setCardState(q: QueuedFile, state: FileState, message?: string): void {
  q.state = state;
  q.card.dataset.state = state;
  q.pill.textContent = state;
  q.errorMessage = state === "error" ? message : undefined;
  q.retryBtn.hidden = state !== "error";
  q.removeBtn.disabled = state === "running";
  if (state === "error" && message) q.card.title = message;
  else q.card.removeAttribute("title");
}

function createCard(file: File): QueuedFile {
  const card = document.createElement("li");
  card.className = "file-item";
  card.dataset.state = "queued";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = file.name;
  name.title = file.name;

  const size = document.createElement("span");
  size.className = "size";
  size.textContent = formatBytes(file.size);

  const pill = document.createElement("span");
  pill.className = "status-pill";
  pill.textContent = "queued";

  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "retry";
  retryBtn.textContent = "Retry";
  retryBtn.hidden = true;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove";
  removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
  removeBtn.textContent = "✕";

  card.append(name, size, pill, retryBtn, removeBtn);

  const id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`) as string;
  const q: QueuedFile = { id, file, state: "queued", card, pill, retryBtn, removeBtn };

  removeBtn.addEventListener("click", () => removeFromQueue(q));
  retryBtn.addEventListener("click", () => void retryOne(q));

  return q;
}

function removeFromQueue(q: QueuedFile): void {
  if (q.state === "running") return;
  const idx = queue.indexOf(q);
  if (idx < 0) return;
  queue.splice(idx, 1);
  q.card.remove();
  renderSummary();
  if (queue.length === 0) queuePane.hidden = true;
}

// --- validation + enqueue ---
function validateAndQueue(files: File[]): void {
  if (!files.length) return;
  const rejects: string[] = [];
  const existingNames = new Set(queue.map((q) => q.file.name));
  let added = 0;

  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(PACKAGE_EXT)) {
      rejects.push(`${f.name} (not a .package)`);
      continue;
    }
    if (f.size > MAX_SIZE_BYTES) {
      rejects.push(`${f.name} (> ${formatBytes(MAX_SIZE_BYTES)})`);
      continue;
    }
    if (existingNames.has(f.name)) continue;
    existingNames.add(f.name);
    const q = createCard(f);
    queue.push(q);
    fileQueueEl.appendChild(q.card);
    added++;
  }

  if (added > 0) {
    queuePane.hidden = false;
    renderSummary();
  }
  if (rejects.length > 0) {
    const shown = rejects.slice(0, 3).join(", ");
    const more = rejects.length > 3 ? ` + ${rejects.length - 3} more` : "";
    flashDropMessage(`Skipped: ${shown}${more}`);
  }
}

// --- summary / button state ---
function renderSummary(): void {
  const totals = queue.reduce(
    (acc, q) => {
      acc.total++;
      acc.bytes += q.file.size;
      acc[q.state]++;
      return acc;
    },
    { total: 0, bytes: 0, queued: 0, running: 0, done: 0, error: 0 },
  );

  if (running) {
    queueSummary.textContent =
      `${totals.done}/${totals.total} done` +
      (totals.error > 0 ? ` · ${totals.error} error${totals.error === 1 ? "" : "s"}` : "") +
      ` · ${totals.running} running`;
  } else if (totals.done === 0 && totals.error === 0) {
    queueSummary.textContent = `${totals.total} file${totals.total === 1 ? "" : "s"} queued · ${formatBytes(totals.bytes)}`;
  } else {
    const parts = [`${totals.done} done`];
    if (totals.error > 0) parts.push(`${totals.error} error${totals.error === 1 ? "" : "s"}`);
    if (totals.queued > 0) parts.push(`${totals.queued} queued`);
    queueSummary.textContent = parts.join(" · ");
  }

  // Button visibility rules:
  // - Start: shown whenever there's something to start or we're mid-run;
  //   hidden only when the queue is fully settled with nothing left queued.
  // - Download ZIP: shown as soon as any file completes successfully;
  //   disabled during runs so the user doesn't zip a half-finished set.
  // - Clear: always shown in the pane; disabled while running.
  startButton.hidden = totals.queued === 0 && !running;
  startButton.disabled = running || totals.queued === 0;
  downloadZipBtn.hidden = totals.done === 0;
  downloadZipBtn.disabled = running || totals.done === 0;
  clearButton.disabled = running || totals.total === 0;
}

// --- processing ---

async function processOne(q: QueuedFile, template: Uint8Array, scale: number): Promise<void> {
  setCardState(q, "running");
  renderSummary();
  try {
    const bytes = new Uint8Array(await q.file.arrayBuffer());
    const result = migratePackage(q.file.name, bytes, template, { fillScale: scale });
    q.result = { outputName: result.outputName, bytes: result.packageBytes };
    downloadFile(result.outputName, result.packageBytes);
    setCardState(q, "done");
  } catch (err) {
    setCardState(q, "error", (err as Error).message);
  } finally {
    renderSummary();
    // Yield so DOM paints between files — keeps the tab responsive during
    // large batches even though migratePackage itself is sync.
    await Promise.resolve();
  }
}

// Pull-based worker pool: each worker loops and takes the next queued item
// off the live queue array until none remain. This handles files added or
// retried *during* a run — they get picked up without restarting the run.
async function runQueue(): Promise<void> {
  if (running) return;
  if (!queue.some((q) => q.state === "queued")) return;
  running = true;
  renderSummary();
  try {
    let template: Uint8Array;
    try {
      template = await activeTemplate();
    } catch (err) {
      const msg = `template load failed: ${(err as Error).message}`;
      for (const q of queue) if (q.state === "queued") setCardState(q, "error", msg);
      return;
    }
    const scale = Number.parseFloat(scaleInput.value) || 4.7985;

    const nextQueued = (): QueuedFile | undefined =>
      queue.find((q) => q.state === "queued");
    const worker = async (): Promise<void> => {
      for (;;) {
        const q = nextQueued();
        if (!q) return;
        await processOne(q, template, scale);
      }
    };
    // Always spawn CONCURRENCY workers, even if fewer items are queued
    // right now: workers that find nothing exit immediately, but if the
    // user adds more files mid-run, there's still a warm pool to handle
    // them at full parallelism.
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    running = false;
    renderSummary();
  }
}

async function retryOne(q: QueuedFile): Promise<void> {
  if (q.state !== "error") return;
  setCardState(q, "queued");
  renderSummary();
  // If a run is in flight, the pull-based worker loop will pick this item
  // up on its next iteration — no need to start a new run.
  if (!running) await runQueue();
}

function clearQueue(): void {
  if (running) return;
  for (const q of queue) q.card.remove();
  queue.length = 0;
  queuePane.hidden = true;
  renderSummary();
}

// --- downloads (semantics unchanged from previous impl) ---
function downloadFile(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function downloadAllAsZip(): Promise<void> {
  const done = queue.filter((q) => q.result);
  if (!done.length) return;
  const zip = new JSZip();
  for (const q of done) zip.file(q.result!.outputName, q.result!.bytes);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "migrated_packages.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- event wiring ---
pickButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  validateAndQueue(Array.from(fileInput.files ?? []));
  fileInput.value = "";
});

startButton.addEventListener("click", () => void runQueue());
clearButton.addEventListener("click", () => clearQueue());
downloadZipBtn.addEventListener("click", () => void downloadAllAsZip());

dropZone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dropZone.classList.add("hover");
});
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("hover");
});
dropZone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dropZone.classList.remove("hover");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("hover");
  validateAndQueue(Array.from(e.dataTransfer?.files ?? []));
});

// Keyboard reachability: the dropzone is focusable and Enter/Space opens
// the file picker, matching mouse-click behavior on the "pick files" button.
dropZone.tabIndex = 0;
dropZone.setAttribute("role", "button");
dropZone.setAttribute("aria-label", "Drop .package files or press Enter to pick files");
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
