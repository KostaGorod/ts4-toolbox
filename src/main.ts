import JSZip from "jszip";
import { migratePackage } from "./migrate";

const commitShaEl = document.getElementById("commit-sha");
const commitLinkEl = document.getElementById("commit-link") as HTMLAnchorElement | null;
if (commitShaEl) commitShaEl.textContent = __COMMIT_SHA__;
if (commitLinkEl && __COMMIT_SHA_FULL__) {
  commitLinkEl.href = `https://github.com/KostaGorod/ts4-toolbox/commit/${__COMMIT_SHA_FULL__}`;
}

const dropZone = document.getElementById("drop") as HTMLElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const pickButton = document.getElementById("pick") as HTMLButtonElement;
const templateInput = document.getElementById("template-input") as HTMLInputElement;
const scaleInput = document.getElementById("scale-input") as HTMLInputElement;
const statusSection = document.getElementById("status") as HTMLElement;
const logList = document.getElementById("log") as HTMLUListElement;
const downloadZipBtn = document.getElementById("download-zip") as HTMLButtonElement;

let bundledTemplate: Uint8Array | null = null;
const results: { name: string; bytes: Uint8Array }[] = [];

async function loadBundledTemplate(): Promise<Uint8Array> {
  if (bundledTemplate) return bundledTemplate;
  const resp = await fetch("./empty-new.gfx");
  if (!resp.ok) throw new Error(`failed to fetch bundled template: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  bundledTemplate = new Uint8Array(buf);
  return bundledTemplate;
}

async function activeTemplate(): Promise<Uint8Array> {
  const override = templateInput.files?.[0];
  if (override) return new Uint8Array(await override.arrayBuffer());
  return loadBundledTemplate();
}

function addLog(text: string, cls: "ok" | "err" | "pending" = "pending"): HTMLLIElement {
  const li = document.createElement("li");
  li.className = cls;
  li.textContent = text;
  logList.appendChild(li);
  return li;
}

function updateLog(li: HTMLLIElement, text: string, cls: "ok" | "err" | "pending"): void {
  li.className = cls;
  li.textContent = text;
}

async function processFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  statusSection.hidden = false;
  downloadZipBtn.disabled = true;

  const template = await activeTemplate();
  const scale = Number.parseFloat(scaleInput.value) || 4.7985;

  for (const file of files) {
    const li = addLog(`${file.name} — processing...`, "pending");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = migratePackage(file.name, bytes, template, { fillScale: scale });
      results.push({ name: result.outputName, bytes: result.packageBytes });
      downloadFile(result.outputName, result.packageBytes);
      updateLog(li, `${file.name} -> ${result.outputName} (${result.packageBytes.length}B)`, "ok");
    } catch (err) {
      updateLog(li, `${file.name} — FAILED: ${(err as Error).message}`, "err");
    }
  }

  downloadZipBtn.disabled = results.length === 0;
}

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
  if (!results.length) return;
  const zip = new JSZip();
  for (const r of results) zip.file(r.name, r.bytes);
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

pickButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  void processFiles(Array.from(fileInput.files ?? []));
  fileInput.value = "";
});
downloadZipBtn.addEventListener("click", () => void downloadAllAsZip());

["dragenter", "dragover"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add("hover");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.remove("hover");
  }),
);
dropZone.addEventListener("drop", (e) => {
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
    f.name.toLowerCase().endsWith(".package"),
  );
  void processFiles(files);
});
