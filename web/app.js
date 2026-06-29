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
const BASE_PX_PER_DAY = 7;
const MIN_VIEW_MS = 30 * 60 * 1000;
const CHILE_TZ = "America/Santiago";

let timelineRecords = [];
const timelineView = {
  start: null,
  end: null,
};

const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const zoomFitBtn = document.getElementById("zoom-fit-btn");
const zoomRangeLabel = document.getElementById("zoom-range-label");

let timelinePanState = null;
let timelineScrollAnchor = null;

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
initTimelineControls();

function initTimelineControls() {
  zoomOutBtn?.addEventListener("click", () => zoomViewport(1 / 1.2, viewportCenterTime()));
  zoomInBtn?.addEventListener("click", () => zoomViewport(1.2, viewportCenterTime()));
  zoomResetBtn?.addEventListener("click", () => resetTimelineView());
  zoomFitBtn?.addEventListener("click", () => fitTimelineToData());

  timelineEl.addEventListener("wheel", (event) => {
    if (!timelineRecords.length || !(event.ctrlKey || event.metaKey)) {
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomViewport(factor, cursorToTime(event, timelineEl));
  }, { passive: false });

  timelineEl.addEventListener("pointerdown", (event) => {
    if (!timelineRecords.length || event.button !== 0) {
      return;
    }
    timelinePanState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: timelineEl.scrollLeft,
    };
    timelineEl.classList.add("is-panning");
    timelineEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  timelineEl.addEventListener("pointermove", (event) => {
    if (!timelinePanState || event.pointerId !== timelinePanState.pointerId) {
      return;
    }
    event.preventDefault();
    const delta = event.clientX - timelinePanState.startX;
    timelineEl.scrollLeft = timelinePanState.scrollLeft - delta;
  });

  const endTimelinePan = (event) => {
    if (!timelinePanState || event.pointerId !== timelinePanState.pointerId) {
      return;
    }
    timelinePanState = null;
    timelineEl.classList.remove("is-panning");
    if (timelineEl.hasPointerCapture(event.pointerId)) {
      timelineEl.releasePointerCapture(event.pointerId);
    }
  };

  timelineEl.addEventListener("pointerup", endTimelinePan);
  timelineEl.addEventListener("pointercancel", endTimelinePan);
}

function viewportCenterTime() {
  const view = getViewBounds();
  const widthPx = computeTimelineWidth(view);
  const span = view.max.getTime() - view.min.getTime();
  const centerX = timelineEl.scrollLeft + timelineEl.clientWidth / 2 - getLabelWidth();
  const ratio = Math.min(1, Math.max(0, centerX / widthPx));
  return view.min.getTime() + ratio * span;
}

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

function validateWhereFilter(params) {
  const where = params.get("where")?.trim();
  const datasetType = params.get("dataset_type")?.trim();
  if (where && !datasetType) {
    return (
      "Dataset type is required when using WHERE. " +
      "Use Butler SQL syntax, e.g. instrument = 'LSSTCam' AND detector = 204"
    );
  }
  return null;
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

function getFullBounds() {
  const min = new Date(TIMELINE_START);
  const max = new Date();
  max.setUTCHours(23, 59, 59, 999);
  return { min, max };
}

function initTimelineView(bounds = getFullBounds()) {
  timelineView.start = new Date(bounds.min);
  timelineView.end = new Date(bounds.max);
}

function getViewBounds() {
  if (!timelineView.start || !timelineView.end) {
    initTimelineView();
  }
  return { min: timelineView.start, max: timelineView.end };
}

function getFullSpanMs() {
  const full = getFullBounds();
  return full.max - full.min;
}

function getViewSpanMs() {
  const view = getViewBounds();
  return view.max - view.min;
}

function clampTimelineView() {
  const full = getFullBounds();
  let span = timelineView.end.getTime() - timelineView.start.getTime();
  if (span < MIN_VIEW_MS) {
    const center = (timelineView.start.getTime() + timelineView.end.getTime()) / 2;
    timelineView.start = new Date(center - MIN_VIEW_MS / 2);
    timelineView.end = new Date(center + MIN_VIEW_MS / 2);
    span = MIN_VIEW_MS;
  }
  if (timelineView.start < full.min) {
    timelineView.start = new Date(full.min);
    timelineView.end = new Date(full.min.getTime() + span);
  }
  if (timelineView.end > full.max) {
    timelineView.end = new Date(full.max);
    timelineView.start = new Date(full.max.getTime() - span);
  }
  if (timelineView.start < full.min) {
    timelineView.start = new Date(full.min);
  }
}

function zoomViewport(factor, anchorMs = null) {
  const view = getViewBounds();
  const span = view.max.getTime() - view.min.getTime();
  const widthPx = computeTimelineWidth(view);
  const anchor = anchorMs ?? viewportCenterTime();
  const anchorPx = getLabelWidth() + ((anchor - view.min.getTime()) / span) * widthPx;
  const anchorScreenX = anchorPx - timelineEl.scrollLeft;

  const newSpan = Math.min(getFullSpanMs(), Math.max(MIN_VIEW_MS, span / factor));
  const anchorRatio = (anchor - view.min.getTime()) / span;
  timelineView.start = new Date(anchor - newSpan * anchorRatio);
  timelineView.end = new Date(anchor + newSpan * (1 - anchorRatio));
  clampTimelineView();
  timelineScrollAnchor = { anchorMs: anchor, anchorScreenX };
  refreshTimeline();
}

function resetTimelineView() {
  timelineScrollAnchor = null;
  initTimelineView();
  refreshTimeline();
}

function fitTimelineToData() {
  if (!timelineRecords.length) {
    return;
  }
  let min = null;
  let max = null;
  for (const record of timelineRecords) {
    const start = parseDate(record.validity_start);
    const end = parseDate(record.validity_end);
    if (start) {
      min = min === null ? start : (start < min ? start : min);
    }
    if (end) {
      max = max === null ? end : (end > max ? end : max);
    }
  }
  if (!min) {
    resetTimelineView();
    return;
  }
  const pad = Math.max((max ?? min).getTime() - min.getTime(), msPerDay()) * 0.08;
  timelineView.start = new Date(min.getTime() - pad);
  timelineView.end = new Date((max ?? getFullBounds().max).getTime() + pad);
  clampTimelineView();
  timelineScrollAnchor = null;
  refreshTimeline();
}

function cursorToTime(event, scrollEl) {
  const view = getViewBounds();
  const widthPx = computeTimelineWidth(view);
  const rect = scrollEl.getBoundingClientRect();
  const cursorX = event.clientX - rect.left + scrollEl.scrollLeft - getLabelWidth();
  const ratio = Math.min(1, Math.max(0, cursorX / widthPx));
  return view.min.getTime() + ratio * (view.max - view.min);
}

function getLabelWidth() {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue("--label-width"), 10) || 280;
}

function refreshTimeline() {
  if (timelineRecords.length) {
    renderTimeline(timelineRecords);
  }
}

function updateZoomRangeLabel(viewBounds) {
  if (!zoomRangeLabel) {
    return;
  }
  const spanMs = viewBounds.max - viewBounds.min;
  const labelMode = resolveLabelMode(spanMs);
  const startLabel = formatAxisTick(viewBounds.min, "utc", { day: true });
  const endLabel = formatAxisTick(viewBounds.max, "utc", { day: true });
  const modeHint = labelMode === "fine"
    ? " · showing times of day"
    : " · zoom in further for times of day";
  zoomRangeLabel.textContent = `${startLabel} → ${endLabel}${modeHint}`;
}

function resolveLabelMode(spanMs) {
  if (spanMs > 60 * msPerDay()) {
    return "coarse";
  }
  if (spanMs > 10 * msPerDay()) {
    return "medium";
  }
  if (spanMs > msPerDay()) {
    return "day";
  }
  return "fine";
}

function resolveTimeScale(spanMs) {
  const labelMode = resolveLabelMode(spanMs);
  if (labelMode === "coarse") {
    return { year: true, month: true };
  }
  if (labelMode === "medium") {
    return { month: true, day: true };
  }
  if (labelMode === "day") {
    return { day: true };
  }
  return { hour: true, quarterHour: true };
}

function showDualTimezone(spanMs) {
  return resolveLabelMode(spanMs) === "fine";
}

function showTimeLabels(spanMs) {
  return resolveLabelMode(spanMs) === "fine";
}

function msPerDay() {
  return 24 * 60 * 60 * 1000;
}

function computeTimelineWidth(bounds) {
  const full = getFullBounds();
  const spanMs = bounds.max - bounds.min;
  const zoomRatio = (full.max - full.min) / spanMs;
  const pxPerDay = BASE_PX_PER_DAY * zoomRatio;
  return Math.max((spanMs / msPerDay()) * pxPerDay, 720);
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

function eachInterval(bounds, stepMs, alignUtc = true) {
  const items = [];
  let t = bounds.min.getTime();
  if (alignUtc && stepMs >= 3600000) {
    const d = new Date(t);
    d.setUTCMinutes(0, 0, 0);
    if (stepMs >= msPerDay()) {
      d.setUTCHours(0);
    }
    t = d.getTime();
    if (t < bounds.min.getTime()) {
      t += stepMs;
    }
  } else {
    t = Math.ceil(t / stepMs) * stepMs;
  }
  while (t <= bounds.max.getTime()) {
    items.push(new Date(t));
    t += stepMs;
  }
  return items;
}

function formatAxisTick(date, zone, scale) {
  const tz = zone === "utc" ? "UTC" : CHILE_TZ;
  if (scale.hour || scale.quarterHour) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  if (scale.day) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }
  if (scale.month) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      month: "short",
      year: "numeric",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
  }).format(date);
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

function addGridLine(grid, bounds, widthPx, date, className, title = null) {
  const line = document.createElement("div");
  line.className = `grid-line ${className}`;
  line.style.left = `${dateToPx(date, bounds, widthPx)}px`;
  if (title) {
    line.title = title;
  }
  grid.appendChild(line);
}

function createGridLayer(bounds, widthPx) {
  const grid = document.createElement("div");
  grid.className = "timeline-grid";
  grid.style.width = `${widthPx}px`;
  const spanMs = bounds.max - bounds.min;
  const scale = resolveTimeScale(spanMs);

  if (scale.quarterHour) {
    for (const tick of eachInterval(bounds, 15 * 60 * 1000)) {
      addGridLine(grid, bounds, widthPx, tick, "grid-line-quarter-hour");
    }
  }
  if (scale.hour) {
    for (const tick of eachInterval(bounds, 3600000)) {
      addGridLine(grid, bounds, widthPx, tick, "grid-line-hour", formatDualTime(tick));
    }
  }
  if (scale.day) {
    for (const day of eachUtcDay(bounds)) {
      addGridLine(grid, bounds, widthPx, day, "grid-line-day", formatDualTime(day));
    }
  }
  if (scale.month) {
    for (const month of eachUtcMonthStart(bounds)) {
      addGridLine(grid, bounds, widthPx, month, "grid-line-month", formatDualTime(month));
    }
  }
  if (scale.year) {
    for (const year of eachUtcYearStart(bounds)) {
      addGridLine(grid, bounds, widthPx, year, "grid-line-year", formatDualTime(year));
    }
  }

  const full = getFullBounds();
  if (bounds.max.getTime() >= full.max.getTime() - msPerDay()) {
    addGridLine(grid, bounds, widthPx, full.max, "grid-line-today", `Today\n${formatDualTime(full.max)}`);
  }

  return grid;
}

function createAxisLabel(date, bounds, widthPx, kind, zone, scale) {
  const tick = document.createElement("div");
  tick.className = `axis-tick axis-tick-${kind} axis-tick-${zone}`;
  tick.style.left = `${dateToPx(date, bounds, widthPx)}px`;
  tick.textContent = formatAxisTick(date, zone, scale);
  tick.title = formatDualTime(date);
  return tick;
}

function subsampleTicks(dates, bounds, widthPx, minPx = 72) {
  if (dates.length <= 1) {
    return dates;
  }
  const maxTicks = Math.max(2, Math.floor(widthPx / minPx));
  if (dates.length <= maxTicks) {
    return dates;
  }
  const step = Math.ceil(dates.length / maxTicks);
  return dates.filter((_, index) => index % step === 0);
}

function buildDualAxis(bounds, widthPx) {
  const spanMs = bounds.max - bounds.min;
  const labelMode = resolveLabelMode(spanMs);
  const scale = resolveTimeScale(spanMs);
  const dualTz = showDualTimezone(spanMs);
  const axisBlock = document.createElement("div");
  axisBlock.className = "timeline-axis-block";
  if (dualTz) {
    axisBlock.classList.add("timeline-axis-fine");
  }

  const side = document.createElement("div");
  side.className = "axis-side";
  side.innerHTML = dualTz
    ? `<span class="axis-side-label">UTC</span><span class="axis-side-label">Chile</span>`
    : `<span class="axis-side-label">Dates (UTC)</span>`;

  const trackWrap = document.createElement("div");
  trackWrap.className = "timeline-track-wrap";
  trackWrap.style.width = `${widthPx}px`;

  const utcRow = document.createElement("div");
  utcRow.className = "axis-row axis-row-utc";
  const chileRow = document.createElement("div");
  chileRow.className = "axis-row axis-row-chile";
  if (!dualTz) {
    chileRow.classList.add("hidden");
  }

  const addTicks = (dates, kind, minPx) => {
    for (const date of subsampleTicks(dates, bounds, widthPx, minPx)) {
      utcRow.appendChild(createAxisLabel(date, bounds, widthPx, kind, "utc", scale));
      if (dualTz) {
        chileRow.appendChild(createAxisLabel(date, bounds, widthPx, kind, "chile", scale));
      }
    }
  };

  if (labelMode === "coarse") {
    addTicks(eachUtcYearStart(bounds), "year", 160);
    addTicks(eachUtcMonthStart(bounds), "month", 130);
  } else if (labelMode === "medium") {
    addTicks(eachUtcMonthStart(bounds), "month", 120);
    addTicks(eachUtcDay(bounds), "day", 100);
  } else if (labelMode === "day") {
    addTicks(eachUtcDay(bounds), "day", 88);
  } else {
    addTicks(eachInterval(bounds, 3600000), "hour", 110);
    addTicks(eachInterval(bounds, 15 * 60 * 1000), "quarter-hour", 72);
  }

  const full = getFullBounds();
  if (bounds.max.getTime() >= full.max.getTime() - msPerDay()) {
    const todayUtc = createAxisLabel(full.max, bounds, widthPx, "today", "utc", scale);
    todayUtc.classList.add("axis-tick-today");
    todayUtc.textContent = "Today";
    utcRow.appendChild(todayUtc);
    if (dualTz) {
      const todayChile = createAxisLabel(full.max, bounds, widthPx, "today", "chile", scale);
      todayChile.classList.add("axis-tick-today");
      todayChile.textContent = "Today";
      chileRow.appendChild(todayChile);
    }
  }

  trackWrap.append(utcRow, chileRow);
  axisBlock.append(side, trackWrap);
  return axisBlock;
}

function appendValidityMarker(track, date, bounds, widthPx, kind, spanMs) {
  if (!date || !showTimeLabels(spanMs)) {
    return;
  }
  const marker = document.createElement("div");
  marker.className = `validity-marker validity-marker-${kind}`;
  marker.style.left = `${dateToPx(date, bounds, widthPx)}px`;
  marker.title = formatDualTime(date);

  const label = document.createElement("span");
  label.className = "validity-marker-label";
  label.textContent = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  marker.appendChild(label);
  track.appendChild(marker);
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

function isOpenEnded(record) {
  if (record.validity_end) {
    return false;
  }
  if (record.validity_range && /∞|inf/i.test(record.validity_range)) {
    return true;
  }
  return true;
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
  } else if (isOpenEnded(record)) {
    lines.push("End: ∞ (open-ended)");
  }
  return lines.join("\n");
}

function renderTimeline(records) {
  timelineEl.innerHTML = "";
  timelineEl.className = "timeline-scroll";

  const colorMap = new Map();
  const bounds = getViewBounds();
  const spanMs = bounds.max - bounds.min;
  const scale = resolveTimeScale(spanMs);
  const widthPx = computeTimelineWidth(bounds);
  const gridLayer = createGridLayer(bounds, widthPx);

  buildLegend(records, colorMap);
  updateZoomRangeLabel(bounds);

  const inner = document.createElement("div");
  inner.className = "timeline-inner";
  inner.style.setProperty("--track-width", `${widthPx}px`);
  inner.dataset.timelineWidth = String(widthPx);

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

  const full = getFullBounds();

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
    const openEnded = isOpenEnded(record);
    const rawEnd = openEnded ? full.max : (parseDate(record.validity_end) ?? full.max);

    const visibleStart = clipDate(rawStart, bounds);
    const visibleEnd = clipDate(rawEnd, bounds);
    if (visibleEnd <= visibleStart) {
      continue;
    }

    const left = dateToPx(visibleStart, bounds, widthPx);
    const right = dateToPx(visibleEnd, bounds, widthPx);
    const width = Math.max(right - left, 3);

    const bar = document.createElement("div");
    bar.className = "timeline-bar";
    const barColor = colorForCollection(record.collection, colorMap);
    if (openEnded && rawEnd.getTime() >= bounds.max.getTime()) {
      bar.classList.add("timeline-bar-open");
    }
    bar.style.left = `${left}px`;
    bar.style.width = `${width}px`;
    bar.style.background = barColor;
    bar.style.setProperty("--bar-color", barColor);
    bar.title = buildBarTooltip(record);

    if (rawStart >= bounds.min && rawStart <= bounds.max) {
      appendValidityMarker(track, rawStart, bounds, widthPx, "start", spanMs);
    }
    if (!openEnded && rawEnd >= bounds.min && rawEnd <= bounds.max) {
      appendValidityMarker(track, rawEnd, bounds, widthPx, "end", spanMs);
    }

    track.appendChild(bar);
    trackWrap.appendChild(track);
    row.append(label, trackWrap);
    rowsContainer.appendChild(row);
  }

  body.appendChild(rowsContainer);
  inner.appendChild(body);
  timelineEl.appendChild(inner);

  if (timelineScrollAnchor) {
    const newView = getViewBounds();
    const newWidth = computeTimelineWidth(newView);
    const newSpan = newView.max.getTime() - newView.min.getTime();
    const anchorPx = getLabelWidth()
      + ((timelineScrollAnchor.anchorMs - newView.min.getTime()) / newSpan) * newWidth;
    timelineEl.scrollLeft = Math.max(0, anchorPx - timelineScrollAnchor.anchorScreenX);
    timelineScrollAnchor = null;
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
    <div class="stat-chip">Timeline: <strong>14 Apr 2024</strong> → <strong>today</strong> · zoom in for times of day</div>
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
  timelineRecords = records;
  initTimelineView();
  timelineScrollAnchor = null;
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
  const whereError = validateWhereFilter(params);
  if (whereError) {
    setStatus(whereError, "error");
    return;
  }

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
