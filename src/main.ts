import JSZip from "jszip";
import { migratePackage, packageFromBitmapBody } from "./migrate";
import { pngToBitmapBody } from "./png";

// ---------- build metadata ----------
{
  const el = document.getElementById("commit-sha");
  const link = document.getElementById("commit-link") as HTMLAnchorElement | null;
  if (el) el.textContent = __COMMIT_SHA__;
  if (link && __COMMIT_SHA_FULL__) {
    link.href = `https://github.com/KostaGorod/ts4-toolbox/commit/${__COMMIT_SHA_FULL__}`;
  }
}

// ---------- live star count on header button ----------
void (async () => {
  const el = document.getElementById("gh-star-count");
  if (!el) return;
  try {
    const r = await fetch("https://api.github.com/repos/KostaGorod/ts4-toolbox", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!r.ok) return;
    const body = (await r.json()) as { stargazers_count?: number };
    if (typeof body.stargazers_count === "number") {
      el.textContent = body.stargazers_count.toLocaleString();
    }
  } catch {
    // offline or rate-limited; count span hides via CSS :empty
  }
})();

// ---------- DOM refs ----------
const dropZone = document.getElementById("drop") as HTMLLabelElement;
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

const pngInput = document.getElementById("png-input") as HTMLInputElement;
const pngSlot = document.getElementById("png-slot") as HTMLSelectElement;
const pngInstanceField = document.getElementById("png-instance-field") as HTMLElement;
const pngInstanceInput = document.getElementById("png-instance") as HTMLInputElement;
const pngGenerate = document.getElementById("png-generate") as HTMLButtonElement;
const pngStatus = document.getElementById("png-status") as HTMLElement;

// ---------- state ----------
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

// ---------- template loading ----------
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

// ---------- helpers ----------
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

let dropMsgTimer: number | undefined;
function flashDropMessage(text: string): void {
  dropMessage.textContent = text;
  dropMessage.hidden = false;
  if (dropMsgTimer !== undefined) window.clearTimeout(dropMsgTimer);
  dropMsgTimer = window.setTimeout(() => {
    dropMessage.hidden = true;
  }, 5000);
}

function setCardState(q: QueuedFile, state: FileState, message?: string): void {
  q.state = state;
  q.card.dataset.state = state;
  q.pill.textContent =
    state === "queued" ? "queued" :
    state === "running" ? "fixing" :
    state === "done" ? "fixed" : "error";
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
  retryBtn.textContent = "Try again";
  retryBtn.hidden = true;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove";
  removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
  removeBtn.textContent = "✕";

  card.append(name, size, pill, retryBtn, removeBtn);

  const id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`) as string;
  const q: QueuedFile = { id, file, state: "queued", card, pill, retryBtn, removeBtn };

  removeBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); removeFromQueue(q); });
  retryBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); void retryOne(q); });

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

// ---------- validation + enqueue ----------
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
      rejects.push(`${f.name} (over ${formatBytes(MAX_SIZE_BYTES)})`);
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

// ---------- summary / button state ----------
function renderSummary(): void {
  const t = queue.reduce(
    (acc, q) => {
      acc.total++;
      acc.bytes += q.file.size;
      acc[q.state]++;
      return acc;
    },
    { total: 0, bytes: 0, queued: 0, running: 0, done: 0, error: 0 },
  );

  if (running) {
    const bits = [`${t.done}/${t.total} fixed`];
    if (t.error > 0) bits.push(`${t.error} didn't fix`);
    if (t.running > 0) bits.push(`${t.running} in flight`);
    queueSummary.textContent = bits.join(" · ");
  } else if (t.done === 0 && t.error === 0) {
    queueSummary.textContent = `${t.total} file${t.total === 1 ? "" : "s"} queued · ${formatBytes(t.bytes)}`;
  } else if (t.done === t.total) {
    queueSummary.textContent = `All ${t.total} fixed — your plumbobs are un-stuck ✨`;
  } else {
    const bits = [`${t.done} fixed`];
    if (t.error > 0) bits.push(`${t.error} didn't fix`);
    if (t.queued > 0) bits.push(`${t.queued} queued`);
    queueSummary.textContent = bits.join(" · ");
  }

  const hasQueued = t.queued > 0;
  startButton.hidden = !hasQueued && !running;
  startButton.disabled = running || !hasQueued;
  startButton.textContent = t.queued === 1 && !running ? "Fix this one" : "Fix them all";
  downloadZipBtn.hidden = t.done === 0;
  downloadZipBtn.disabled = running || t.done === 0;
  clearButton.disabled = running || t.total === 0;
}

// ---------- processing ----------
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
    await Promise.resolve();
  }
}

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
      const msg = `Template load failed: ${(err as Error).message}`;
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
  if (!running) await runQueue();
}

function clearQueue(): void {
  if (running) return;
  for (const q of queue) q.card.remove();
  queue.length = 0;
  queuePane.hidden = true;
  renderSummary();
}

// ---------- downloads ----------
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
  a.download = "sims4_loading_screens.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- PNG → .package (Make) ----------
function setPngStatus(text: string, kind: "ok" | "err" | "info" = "info"): void {
  pngStatus.textContent = text;
  pngStatus.hidden = !text;
  pngStatus.dataset.state = kind === "ok" ? "ok" : kind === "err" ? "err" : "";
}

function parseInstanceHex(raw: string): bigint {
  const s = raw.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{1,16}$/i.test(s)) {
    throw new Error("Instance ID should be 1–16 hex characters (0–9, a–f).");
  }
  return BigInt("0x" + s);
}

function currentInstance(): bigint {
  if (pngSlot.value === "custom") return parseInstanceHex(pngInstanceInput.value);
  return parseInstanceHex(pngSlot.value);
}

pngSlot.addEventListener("change", () => {
  const isCustom = pngSlot.value === "custom";
  pngInstanceField.classList.toggle("is-hidden", !isCustom);
  if (isCustom) pngInstanceInput.focus();
});

pngInput.addEventListener("change", () => {
  pngGenerate.disabled = !(pngInput.files && pngInput.files.length > 0);
  setPngStatus("");
});

pngGenerate.addEventListener("click", async () => {
  const file = pngInput.files?.[0];
  if (!file) return;
  pngGenerate.disabled = true;
  setPngStatus("Reading your image…", "info");
  try {
    const instance = currentInstance();
    const pngBytes = new Uint8Array(await file.arrayBuffer());
    const { width, height, bitmapBody } = await pngToBitmapBody(pngBytes);
    setPngStatus(`Encoded ${width} × ${height}. Building the package…`, "info");
    const template = await activeTemplate();
    const scale = Number.parseFloat(scaleInput.value) || 4.7985;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "loading_screen";
    const { outputName, packageBytes } = packageFromBitmapBody(bitmapBody, template, {
      fillScale: scale,
      instance,
      outputName: `${baseName}.package`,
    });
    downloadFile(outputName, packageBytes);
    setPngStatus(
      `Done — ${outputName} (${formatBytes(packageBytes.length)}). Drop it into your Mods folder.`,
      "ok",
    );
  } catch (err) {
    setPngStatus(`Didn't work — ${(err as Error).message}`, "err");
  } finally {
    pngGenerate.disabled = !(pngInput.files && pngInput.files.length > 0);
  }
});

// ---------- event wiring ----------
// Label[for] opens the picker when clicked; but we also want explicit keyboard
// reachability for the whole drop card.
dropZone.setAttribute("tabindex", "0");
dropZone.setAttribute("role", "button");
dropZone.setAttribute(
  "aria-label",
  "Drop or pick .package files to fix",
);
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

pickButton.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  validateAndQueue(Array.from(fileInput.files ?? []));
  fileInput.value = "";
});

startButton.addEventListener("click", () => void runQueue());
clearButton.addEventListener("click", () => clearQueue());
downloadZipBtn.addEventListener("click", () => void downloadAllAsZip());

// Drag state — listen on the drop zone for the visual hover state, on the
// whole window to pick up the mascot animation even if the pointer is near
// but not over the zone.
function showOver(): void { dropZone.classList.add("is-over"); document.body.classList.add("is-dragging"); }
function clearOver(): void { dropZone.classList.remove("is-over"); document.body.classList.remove("is-dragging"); }

dropZone.addEventListener("dragenter", (e) => { e.preventDefault(); showOver(); });
dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); showOver(); });
dropZone.addEventListener("dragleave", (e) => { e.preventDefault(); clearOver(); });
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  clearOver();
  validateAndQueue(Array.from(e.dataTransfer?.files ?? []));
});

// Prevent the browser from navigating to a dropped file if the user misses
// the drop zone entirely.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => { e.preventDefault(); clearOver(); });
