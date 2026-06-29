/**
 * Calibration timeline visualization.
 */

function resolveApiUrl() {
  const override = document.querySelector('meta[name="calib-api-url"]')?.content?.trim();
  if (override) {
    return override;
  }

  const userMatch = window.location.pathname.match(/^\/~[^/]+/);
  if (userMatch) {
    return `${window.location.origin}${userMatch[0]}/cgi-bin/calib_api.cgi`;
  }

  return new URL("cgi-bin/calib_api.cgi", window.location.href).href;
}

const API_URL = resolveApiUrl();

const PALETTE = [
  "#38bdf8", "#34d399", "#a78bfa", "#fb7185",
  "#fbbf24", "#2dd4bf", "#f472b6", "#818cf8",
];

const form = document.getElementById("query-form");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const timelineSection = document.getElementById("timeline-section");
const timelineEl = document.getElementById("timeline");
const legendEl = document.getElementById("legend");
const tableSection = document.getElementById("table-section");
const tableBody = document.querySelector("#details-table tbody");
const submitBtn = document.getElementById("submit-btn");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runQuery();
});

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
  statusEl.classList.remove("hidden");
}

function hideStatus() {
  statusEl.classList.add("hidden");
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!date) return "∞";
  return date.toISOString().slice(0, 10);
}

function shortLabel(record) {
  const dims = record.dimensions.replace(/[{}']/g, "");
  const collectionTail = record.collection.split("/").slice(-2).join("/");
  return `${collectionTail} · ${dims}`;
}

function colorForCollection(collection, colorMap) {
  if (!colorMap.has(collection)) {
    colorMap.set(collection, PALETTE[colorMap.size % PALETTE.length]);
  }
  return colorMap.get(collection);
}

function computeTimeBounds(records) {
  let min = null;
  let max = null;

  for (const record of records) {
    const start = parseDate(record.validity_start);
    let end = parseDate(record.validity_end);

    if (start) {
      min = min === null ? start : (start < min ? start : min);
    }
    if (end) {
      max = max === null ? end : (end > max ? end : max);
    } else if (start) {
      const openEnd = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
      max = max === null ? openEnd : (openEnd > max ? openEnd : max);
    }
  }

  if (!min || !max || min >= max) {
    const now = new Date();
    min = new Date(now.getFullYear() - 1, 0, 1);
    max = new Date(now.getFullYear() + 1, 0, 1);
  }

  const pad = (max - min) * 0.04;
  return { min: new Date(min - pad), max: new Date(max + pad) };
}

function positionPercent(date, bounds) {
  const span = bounds.max - bounds.min;
  if (!date || span <= 0) return 0;
  return ((date - bounds.min) / span) * 100;
}

function buildAxis(bounds) {
  const axis = document.createElement("div");
  axis.className = "axis";

  const label = document.createElement("div");
  label.className = "axis-label";
  label.textContent = "Time →";
  axis.appendChild(label);

  const track = document.createElement("div");
  track.className = "axis-track";

  const tickCount = 6;
  for (let i = 0; i <= tickCount; i += 1) {
    const fraction = i / tickCount;
    const time = new Date(bounds.min.getTime() + fraction * (bounds.max - bounds.min));
    const tick = document.createElement("div");
    tick.className = "axis-tick";
    tick.style.left = `${fraction * 100}%`;
    tick.textContent = formatDate(time);
    track.appendChild(tick);
  }

  axis.appendChild(track);
  return axis;
}

function buildLegend(records, colorMap) {
  legendEl.innerHTML = "";
  const collections = [...new Set(records.map((r) => r.collection))].sort();
  for (const collection of collections) {
    const item = document.createElement("span");
    item.className = "legend-item";

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = colorForCollection(collection, colorMap);

    const text = document.createElement("span");
    text.textContent = collection.split("/").slice(-1)[0];

    item.append(swatch, text);
    legendEl.appendChild(item);
  }
}

function renderTimeline(records) {
  timelineEl.innerHTML = "";
  const colorMap = new Map();
  const bounds = computeTimeBounds(records);

  timelineEl.appendChild(buildAxis(bounds));
  buildLegend(records, colorMap);

  const sorted = [...records].sort((a, b) => {
    const aStart = parseDate(a.validity_start)?.getTime() ?? 0;
    const bStart = parseDate(b.validity_start)?.getTime() ?? 0;
    return aStart - bStart || a.collection.localeCompare(b.collection);
  });

  for (const record of sorted) {
    const row = document.createElement("div");
    row.className = "timeline-row";

    const label = document.createElement("div");
    label.className = "row-label";
    label.textContent = shortLabel(record);
    label.title = `${record.collection}\n${record.dimensions}`;

    const track = document.createElement("div");
    track.className = "row-track";

    const start = parseDate(record.validity_start) ?? bounds.min;
    const end = parseDate(record.validity_end) ?? bounds.max;

    const left = positionPercent(start, bounds);
    const right = positionPercent(end, bounds);
    const width = Math.max(right - left, 0.4);

    const bar = document.createElement("div");
    bar.className = "timeline-bar";
    bar.style.left = `${left}%`;
    bar.style.width = `${width}%`;
    bar.style.background = colorForCollection(record.collection, colorMap);
    bar.title = [
      record.dataset_type,
      record.run,
      record.collection,
      record.dimensions,
      record.validity_range,
    ].join("\n");

    track.appendChild(bar);
    row.append(label, track);
    timelineEl.appendChild(row);
  }
}

function renderTable(records) {
  tableBody.innerHTML = "";
  for (const record of records) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(record.dataset_type)}</td>
      <td class="mono">${escapeHtml(record.run)}</td>
      <td class="mono">${escapeHtml(record.collection)}</td>
      <td class="mono">${escapeHtml(record.dimensions)}</td>
      <td class="mono">${escapeHtml(record.validity_range)}</td>
    `;
    tableBody.appendChild(row);
  }
}

function renderSummary(records) {
  const collections = new Set(records.map((r) => r.collection));
  const types = new Set(records.map((r) => r.dataset_type));

  summaryEl.innerHTML = `
    <div class="stat-chip"><strong>${records.length}</strong> calibration${records.length === 1 ? "" : "s"}</div>
    <div class="stat-chip"><strong>${collections.size}</strong> collection${collections.size === 1 ? "" : "s"}</div>
    <div class="stat-chip"><strong>${types.size}</strong> dataset type${types.size === 1 ? "" : "s"}</div>
  `;
  summaryEl.classList.remove("hidden");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(
      `API returned HTML instead of JSON (${response.status}). ` +
      `Check that ${API_URL} exists and is executable. ` +
      `Response: ${snippet || "(empty)"}`
    );
  }
}

async function runQuery() {
  const params = new URLSearchParams(new FormData(form));
  submitBtn.disabled = true;
  setStatus("Querying Butler registry…", "loading");
  timelineSection.classList.add("hidden");
  tableSection.classList.add("hidden");
  summaryEl.classList.add("hidden");

  try {
    const response = await fetch(`${API_URL}?${params.toString()}`);
    const payload = await readJsonResponse(response);

    if (!response.ok || payload.error) {
      const detail = payload.detail ? `\n\n${payload.detail}` : "";
      throw new Error((payload.error || `Request failed (${response.status})`) + detail);
    }

    const records = payload.records ?? [];
    hideStatus();

    if (records.length === 0) {
      setStatus("No calibrations matched your query.", "empty");
      return;
    }

    renderSummary(records);
    renderTimeline(records);
    renderTable(records);
    timelineSection.classList.remove("hidden");
    tableSection.classList.remove("hidden");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitBtn.disabled = false;
  }
}
