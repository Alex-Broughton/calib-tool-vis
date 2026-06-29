/**
 * Calibration timeline visualization.
 *
 * Hosting modes:
 *   static — S3DF public_html; run query.sh on cluster, load data/latest.json
 *   server — serve.py via SSH tunnel; live API at /api/query
 *   cgi    — legacy CGI endpoint (if available)
 */

function resolveMode() {
  const override = document.querySelector('meta[name="calib-mode"]')?.content?.trim();
  if (override) {
    return override;
  }
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "server";
  }
  if (window.location.hostname === "s3df.slac.stanford.edu") {
    return "static";
  }
  if (document.querySelector('meta[name="calib-api-url"]')?.content?.trim()) {
    return "cgi";
  }
  return "static";
}

function resolveApiUrl() {
  const override = document.querySelector('meta[name="calib-api-url"]')?.content?.trim();
  if (override) {
    return override;
  }
  if (resolveMode() === "server") {
    return new URL("/api/query", window.location.href).href;
  }
  const userMatch = window.location.pathname.match(/^\/~[^/]+/);
  if (userMatch) {
    return `${window.location.origin}${userMatch[0]}/cgi-bin/calib_api.cgi`;
  }
  return new URL("cgi-bin/calib_api.cgi", window.location.href).href;
}

const MODE = resolveMode();
const API_URL = resolveApiUrl();
const DATA_URL = new URL("data/latest.json", window.location.href).href;

const TIMELINE_START = Date.UTC(2024, 3, 14, 0, 0, 0, 0);
const PX_PER_DAY = 7;
const CHILE_TZ = "America/Santiago";

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
const loadBtn = document.getElementById("load-btn");
const uploadInput = document.getElementById("upload-input");
const commandPanel = document.getElementById("command-panel");
const commandText = document.getElementById("command-text");
const hostingNote = document.getElementById("hosting-note");

const utcDateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const chileDateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: CHILE_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const utcMonthFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

const chileMonthFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: CHILE_TZ,
  month: "short",
  year: "numeric",
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runQuery();
});

loadBtn.addEventListener("click", async () => {
  await loadStaticResults(true);
});

uploadInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const records = normalizeRecords(JSON.parse(text));
    displayRecords(records);
    hideStatus();
  } catch (error) {
    setStatus(`Could not read JSON file: ${error.message}`, "error");
  } finally {
    uploadInput.value = "";
  }
});

initHostingNote();

function initHostingNote() {
  if (MODE === "static") {
    hostingNote.textContent =
      "Static hosting: run query.sh on the cluster, then load data/latest.json here.";
    hostingNote.classList.remove("hidden");
  } else if (MODE === "server") {
    hostingNote.textContent = "Interactive mode via serve.py.";
    hostingNote.classList.remove("hidden");
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildQueryCommand(params) {
  const parts = ["query.sh", "-r", shellQuote(params.get("repo")), "-c", shellQuote(params.get("collection"))];
  const datasetType = params.get("dataset_type")?.trim();
  const where = params.get("where")?.trim();
  if (datasetType) {
    parts.push("-d", shellQuote(datasetType));
  }
  if (where) {
    parts.push("-w", shellQuote(where));
  }
  return parts.join(" ");
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
  statusEl.classList.remove("hidden");
}

function hideStatus() {
  statusEl.classList.add("hidden");
}

function showCommand(params) {
  commandText.textContent = buildQueryCommand(params);
  commandPanel.classList.remove("hidden");
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getTimelineBounds() {
  const min = new Date(TIMELINE_START);
  const max = new Date();
  max.setUTCHours(23, 59, 59, 999);
  return { min, max };
}

function msPerDay() {
  return 24 * 60 * 60 * 1000;
}

function computeTimelineWidth(bounds) {
  const days = Math.ceil((bounds.max - bounds.min) / msPerDay()) + 1;
  return Math.max(days * PX_PER_DAY, 720);
}

function dateToPx(date, bounds, widthPx) {
  const span = bounds.max - bounds.min;
  if (!date || span <= 0) return 0;
  return ((date - bounds.min) / span) * widthPx;
}

function clipDate(date, bounds) {
  return new Date(
    Math.min(Math.max(date.getTime(), bounds.min.getTime()), bounds.max.getTime())
  );
}

function formatUtc(date) {
  return `${utcDateTimeFmt.format(date)} UTC`;
}

function formatChile(date) {
  return `${chileDateTimeFmt.format(date)} Chile`;
}

function formatDualTime(date) {
  return `${formatUtc(date)}\n${formatChile(date)}`;
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

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function eachUtcDay(bounds) {
  const days = [];
  const cursor = startOfUtcDay(bounds.min);
  const end = bounds.max.getTime();
  while (cursor.getTime() <= end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function eachUtcMonthStart(bounds) {
  const months = [];
  const cursor = startOfUtcDay(bounds.min);
  cursor.setUTCDate(1);
  if (cursor < bounds.min) {
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  while (cursor.getTime() <= bounds.max.getTime()) {
    months.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function eachUtcYearStart(bounds) {
  const years = [];
  for (let year = bounds.min.getUTCFullYear(); year <= bounds.max.getUTCFullYear(); year += 1) {
    const jan1 = Date.UTC(year, 0, 1, 0, 0, 0, 0);
    if (jan1 >= bounds.min.getTime() && jan1 <= bounds.max.getTime()) {
      years.push(new Date(jan1));
    }
  }
  return years;
}

function createGridLayer(bounds, widthPx) {
  const grid = document.createElement("div");
  grid.className = "timeline-grid";
  grid.style.width = `${widthPx}px`;

  for (const day of eachUtcDay(bounds)) {
    const line = document.createElement("div");
    line.className = "grid-line grid-line-day";
    line.style.left = `${dateToPx(day, bounds, widthPx)}px`;
    grid.appendChild(line);
  }

  for (const month of eachUtcMonthStart(bounds)) {
    const line = document.createElement("div");
    line.className = "grid-line grid-line-month";
    line.style.left = `${dateToPx(month, bounds, widthPx)}px`;
    grid.appendChild(line);
  }

  for (const year of eachUtcYearStart(bounds)) {
    const line = document.createElement("div");
    line.className = "grid-line grid-line-year";
    line.style.left = `${dateToPx(year, bounds, widthPx)}px`;
    line.title = formatDualTime(year);
    grid.appendChild(line);
  }

  const todayLine = document.createElement("div");
  todayLine.className = "grid-line grid-line-today";
  todayLine.style.left = `${dateToPx(bounds.max, bounds, widthPx)}px`;
  todayLine.title = `Today\n${formatDualTime(bounds.max)}`;
  grid.appendChild(todayLine);

  return grid;
}

function createAxisLabel(date, bounds, widthPx, kind, zone) {
  const tick = document.createElement("div");
  tick.className = `axis-tick axis-tick-${kind} axis-tick-${zone}`;
  tick.style.left = `${dateToPx(date, bounds, widthPx)}px`;

  if (zone === "utc") {
    tick.textContent = kind === "year"
      ? String(date.getUTCFullYear())
      : utcMonthFmt.format(date);
  } else {
    tick.textContent = kind === "year"
      ? new Intl.DateTimeFormat("en-GB", { timeZone: CHILE_TZ, year: "numeric" }).format(date)
      : chileMonthFmt.format(date);
  }

  tick.title = formatDualTime(date);
  return tick;
}

function buildDualAxis(bounds, widthPx) {
  const axisBlock = document.createElement("div");
  axisBlock.className = "timeline-axis-block";

  const side = document.createElement("div");
  side.className = "axis-side";
  side.innerHTML = `<span class="axis-side-label">UTC</span><span class="axis-side-label">Chile</span>`;

  const trackWrap = document.createElement("div");
  trackWrap.className = "timeline-track-wrap";
  trackWrap.style.width = `${widthPx}px`;

  const utcRow = document.createElement("div");
  utcRow.className = "axis-row axis-row-utc";
  const chileRow = document.createElement("div");
  chileRow.className = "axis-row axis-row-chile";

  utcRow.appendChild(createAxisLabel(bounds.min, bounds, widthPx, "month", "utc"));
  chileRow.appendChild(createAxisLabel(bounds.min, bounds, widthPx, "month", "chile"));

  for (const year of eachUtcYearStart(bounds)) {
    utcRow.appendChild(createAxisLabel(year, bounds, widthPx, "year", "utc"));
    chileRow.appendChild(createAxisLabel(year, bounds, widthPx, "year", "chile"));
  }

  for (const month of eachUtcMonthStart(bounds)) {
    utcRow.appendChild(createAxisLabel(month, bounds, widthPx, "month", "utc"));
    chileRow.appendChild(createAxisLabel(month, bounds, widthPx, "month", "chile"));
  }

  const todayUtc = createAxisLabel(bounds.max, bounds, widthPx, "month", "utc");
  todayUtc.classList.add("axis-tick-today");
  todayUtc.textContent = "Today";
  const todayChile = createAxisLabel(bounds.max, bounds, widthPx, "month", "chile");
  todayChile.classList.add("axis-tick-today");
  todayChile.textContent = "Today";
  utcRow.appendChild(todayUtc);
  chileRow.appendChild(todayChile);

  trackWrap.append(utcRow, chileRow);
  axisBlock.append(side, trackWrap);
  return axisBlock;
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

function buildBarTooltip(record) {
  const lines = [
    record.dataset_type,
    record.run,
    record.collection,
    record.dimensions,
    record.validity_range,
  ];
  const start = parseDate(record.validity_start);
  const end = parseDate(record.validity_end);
  if (start) {
    lines.push(`Start: ${formatUtc(start)}`, `       ${formatChile(start)}`);
  }
  if (end) {
    lines.push(`End: ${formatUtc(end)}`, `     ${formatChile(end)}`);
  }
  return lines.join("\n");
}

function renderTimeline(records) {
  timelineEl.innerHTML = "";
  timelineEl.className = "timeline-scroll";

  const colorMap = new Map();
  const bounds = getTimelineBounds();
  const widthPx = computeTimelineWidth(bounds);
  const gridLayer = createGridLayer(bounds, widthPx);

  buildLegend(records, colorMap);

  const inner = document.createElement("div");
  inner.className = "timeline-inner";
  inner.style.setProperty("--track-width", `${widthPx}px`);

  inner.appendChild(buildDualAxis(bounds, widthPx));

  const sorted = [...records].sort((a, b) => {
    const aStart = parseDate(a.validity_start)?.getTime() ?? 0;
    const bStart = parseDate(b.validity_start)?.getTime() ?? 0;
    return aStart - bStart || a.collection.localeCompare(b.collection);
  });

  const body = document.createElement("div");
  body.className = "timeline-body";

  const gridMount = document.createElement("div");
  gridMount.className = "timeline-grid-mount";
  gridMount.style.width = `${widthPx}px`;
  gridMount.appendChild(gridLayer);
  body.appendChild(gridMount);

  const rowsContainer = document.createElement("div");
  rowsContainer.className = "timeline-rows";

  for (const record of sorted) {
    const row = document.createElement("div");
    row.className = "timeline-row";

    const label = document.createElement("div");
    label.className = "row-label";
    label.textContent = shortLabel(record);
    label.title = `${record.collection}\n${record.dimensions}`;

    const trackWrap = document.createElement("div");
    trackWrap.className = "timeline-track-wrap";
    trackWrap.style.width = `${widthPx}px`;

    const track = document.createElement("div");
    track.className = "row-track";

    const rawStart = parseDate(record.validity_start) ?? bounds.min;
    const rawEnd = parseDate(record.validity_end) ?? bounds.max;
    const start = clipDate(rawStart, bounds);
    const end = clipDate(rawEnd, bounds);

    const left = dateToPx(start, bounds, widthPx);
    const right = dateToPx(end, bounds, widthPx);
    const width = Math.max(right - left, 3);

    const bar = document.createElement("div");
    bar.className = "timeline-bar";
    if (!record.validity_end) {
      bar.classList.add("timeline-bar-open");
    }
    bar.style.left = `${left}px`;
    bar.style.width = `${width}px`;
    bar.style.background = colorForCollection(record.collection, colorMap);
    bar.title = buildBarTooltip(record);

    track.appendChild(bar);
    trackWrap.appendChild(track);
    row.append(label, trackWrap);
    rowsContainer.appendChild(row);
  }

  body.appendChild(rowsContainer);
  inner.appendChild(body);
  timelineEl.appendChild(inner);
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
  const bounds = getTimelineBounds();

  summaryEl.innerHTML = `
    <div class="stat-chip"><strong>${records.length}</strong> calibration${records.length === 1 ? "" : "s"}</div>
    <div class="stat-chip"><strong>${collections.size}</strong> collection${collections.size === 1 ? "" : "s"}</div>
    <div class="stat-chip"><strong>${types.size}</strong> dataset type${types.size === 1 ? "" : "s"}</div>
    <div class="stat-chip">Timeline: <strong>14 Apr 2024</strong> → <strong>today</strong></div>
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

function normalizeRecords(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload?.records && Array.isArray(payload.records)) {
    return payload.records;
  }
  throw new Error("JSON must be an array of records or an object with a records array.");
}

async function readJsonResponse(response, sourceLabel) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(
      `${sourceLabel} returned non-JSON (${response.status}). ` +
      `Response: ${snippet || "(empty)"}`
    );
  }
}

function displayRecords(records) {
  hideStatus();
  commandPanel.classList.add("hidden");

  if (records.length === 0) {
    setStatus("No calibrations matched your query.", "empty");
    timelineSection.classList.add("hidden");
    tableSection.classList.add("hidden");
    summaryEl.classList.add("hidden");
    return;
  }

  renderSummary(records);
  renderTimeline(records);
  renderTable(records);
  timelineSection.classList.remove("hidden");
  tableSection.classList.remove("hidden");
}

async function loadStaticResults(showErrors) {
  submitBtn.disabled = true;
  loadBtn.disabled = true;
  setStatus("Loading data/latest.json…", "loading");

  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!response.ok) {
      throw new Error(
        `No results file yet (${response.status}). Run query.sh on the cluster first.`
      );
    }
    const payload = await readJsonResponse(response, "data/latest.json");
    displayRecords(normalizeRecords(payload));
  } catch (error) {
    if (showErrors) {
      setStatus(error.message, "error");
    } else {
      hideStatus();
    }
  } finally {
    submitBtn.disabled = false;
    loadBtn.disabled = false;
  }
}

async function runLiveQuery(params) {
  const response = await fetch(`${API_URL}?${params.toString()}`);
  const payload = await readJsonResponse(response, "API");

  if (!response.ok || payload.error) {
    const detail = payload.detail ? `\n\n${payload.detail}` : "";
    throw new Error((payload.error || `Request failed (${response.status})`) + detail);
  }

  displayRecords(normalizeRecords(payload));
}

async function runQuery() {
  const params = new URLSearchParams(new FormData(form));
  submitBtn.disabled = true;
  loadBtn.disabled = true;
  timelineSection.classList.add("hidden");
  tableSection.classList.add("hidden");
  summaryEl.classList.add("hidden");

  if (MODE === "static") {
    showCommand(params);
    setStatus("Run the command below on the cluster, then click Load results.", "loading");
    await loadStaticResults(false);
    if (statusEl.classList.contains("hidden")) {
      return;
    }
    submitBtn.disabled = false;
    loadBtn.disabled = false;
    return;
  }

  setStatus("Querying Butler registry…", "loading");
  commandPanel.classList.add("hidden");

  try {
    await runLiveQuery(params);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitBtn.disabled = false;
    loadBtn.disabled = false;
  }
}

if (MODE === "static") {
  loadStaticResults(false);
}
