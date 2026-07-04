// Modularized data & UI logic
// Plain script version. Call `init()` from js/main.js.

// =====================
// CACHE
// =====================
let excelCache = JSON.parse(localStorage.getItem("excelCache"));

// =====================
// APP STATE
// =====================
const CONFIG = {
    currentPage: 1,
    rowsPerPage: 10,

    data: [],
    filteredData: [],

    columns: [],
    sortKey: null,
    sortOrder: "asc",

    search: "",
    site: "",
    missing: "", // Missing episodes filter

    tableBody: null,
    tableHead: null,
    pagination: null,
};

// Store missing values for each row: { rowIndex: "Complete" | "Has Missing" | "N/A" | "Error" }
const missingValuesMap =
    JSON.parse(
        localStorage.getItem("missingValuesMap")
    ) || {};

// =====================
// TVMAZE INFO CACHE (Status Tv, Show Type, Genres, Rating)
// =====================
// { "Series Title": { tvStatus, tvType, genres, rating, timestamp } }
let tvInfoCache = JSON.parse(localStorage.getItem("tvInfoCache") || "{}");

// Column name → tvmazeCache field mapping
const TV_INFO_COL_MAP = {
    "Status Tv": "tvStatus",
    "Show Type":  "tvType",
    "Genres":     "genres",
    "Rating":     "rating",
};

// Helper to determine which columns to render and in what order
function getColumnsToRender() {
    const statusFilter = document.getElementById("statusFilter")?.value || "";
    const columnsToRender = [...CONFIG.columns];

    // Status Tv goes right after Status
    if (!columnsToRender.includes("Status Tv")) {
        const statusIdx = columnsToRender.indexOf("Status");
        columnsToRender.splice(statusIdx >= 0 ? statusIdx + 1 : columnsToRender.length, 0, "Status Tv");
    }

    // Show Type goes right after Type, then Genres, then Rating
    if (!columnsToRender.includes("Show Type")) {
        const typeIdx = columnsToRender.indexOf("Type");
        columnsToRender.splice(typeIdx >= 0 ? typeIdx + 1 : columnsToRender.length, 0, "Show Type");
    }
    if (!columnsToRender.includes("Genres")) {
        const showTypeIdx = columnsToRender.indexOf("Show Type");
        columnsToRender.splice(showTypeIdx >= 0 ? showTypeIdx + 1 : columnsToRender.length, 0, "Genres");
    }
    if (!columnsToRender.includes("Rating")) {
        const genresIdx = columnsToRender.indexOf("Genres");
        columnsToRender.splice(genresIdx >= 0 ? genresIdx + 1 : columnsToRender.length, 0, "Rating");
    }

    // Missing always goes right after Rating
    if (!columnsToRender.includes("Missing")) {
        const ratingIdx = columnsToRender.indexOf("Rating");
        columnsToRender.splice(ratingIdx >= 0 ? ratingIdx + 1 : columnsToRender.length, 0, "Missing");
    }

    // Status Diff goes right after Missing
    if (!columnsToRender.includes("Status Diff")) {
        const missingIdx = columnsToRender.indexOf("Missing");
        columnsToRender.splice(missingIdx >= 0 ? missingIdx + 1 : columnsToRender.length, 0, "Status Diff");
    }

    // Read more always goes right after Status Diff (or Missing if Status Diff is missing)
    if (!columnsToRender.includes("Read more")) {
        const diffIdx = columnsToRender.indexOf("Status Diff");
        const missingIdx = columnsToRender.indexOf("Missing");
        const insertIdx = diffIdx >= 0 ? diffIdx + 1 : (missingIdx >= 0 ? missingIdx + 1 : columnsToRender.length);
        columnsToRender.splice(insertIdx, 0, "Read more");
    }

    if (statusFilter === "Download") {
        const typeIndex = columnsToRender.indexOf("Type");
        if (typeIndex >= 0 && !columnsToRender.includes("Download")) {
            columnsToRender.splice(typeIndex + 1, 0, "Download");
        } else if (!columnsToRender.includes("Download")) {
            columnsToRender.push("Download");
        }
    }
    return columnsToRender;
}

// Render one of the 4 TVMaze-info columns. Uses the shared tvmazeCache
// (already populated by fetchTVMazeSeries) so no extra network calls needed.
function renderTVMazeCell(row, col) {
    const seriesTitle = getSeriesTitle(row);
    const field = TV_INFO_COL_MAP[col];
    const safeTitle = (seriesTitle || "").replace(/"/g, "");

    if (!seriesTitle) return `<td class="tvinfo-cell" data-series="${safeTitle}" data-col="${col}">—</td>`;

    // Try in-memory tvmazeCache (populated during missing-episode lookup)
    const cached = tvmazeCache[seriesTitle];
    if (cached && cached.data && cached.data[field] !== undefined) {
        const val = cached.data[field] || "—";
        
        if (col === "Rating" && val !== "—") {
            return `<td class="tvinfo-cell" data-series="${safeTitle}" data-col="${col}">
                <span class="badge rounded-pill bg-warning">
                    <i class="bi bi-star me-1"></i>${val}
                </span>
            </td>`;
        }
        
        return `<td class="tvinfo-cell" data-series="${safeTitle}" data-col="${col}">${val}</td>`;
    }

    return `<td class="tvinfo-cell" data-series="${safeTitle}" data-col="${col}"><span class="text-muted small">…</span></td>`;
}

// After each missing-episode resolution (which calls fetchTVMazeSeries),
// push the new TVMaze info into any matching cells already on screen.
function updateTVInfoCellsInDOM(seriesTitle) {
    const cached = tvmazeCache[seriesTitle];
    if (!cached || !cached.data) return;

    for (const [col, field] of Object.entries(TV_INFO_COL_MAP)) {
        const safeTitle = (seriesTitle || "").replace(/"/g, '\\"');
        const cells = document.querySelectorAll(
            `.tvinfo-cell[data-series="${safeTitle}"][data-col="${col}"]`
        );
        const val = cached.data[field] || "—";
        cells.forEach(cell => { cell.textContent = val; });
    }
}

const SEARCH_SITES = {
    digimoviez: {
        label: "DigiMoviez",
        url: "https://digimoviez.com/?s=",
    },
    f2my: {
        label: "F2MY",
        url: "https://www.f2my.top/?s=",
    },
    custom: {
        label: "Custom",
        url: "",
    }
};


// =====================
// TVMaze INTEGRATION
// =====================

// Cache for TVMaze results: { "Series Title": { seasons: {...}, timestamp: ... } }
let tvmazeCache = {};

// Helper to get series title for TVMaze lookup
function getSeriesTitle(row) {
    const exactKeys = ["Serial Name", "serial name", "Serial name", "title", "Title", "Name", "name"];
    let title = getRowValue(row, exactKeys);
    return title || "";
}

// Helper to get episodes string for local data
// Episodes are stored in Season01, Season02, Season03... columns
function getEpisodesString(row) {
    // First try to get from a single "episodes" column
    let episodesValue = getRowValue(row, ["episodes", "Episodes", "episode", "Episode"]);
    if (episodesValue) return episodesValue;

    // Otherwise, combine all Season columns
    const seasonEpisodes = [];
    for (const key of Object.keys(row).sort()) {
        if (key.match(/^Season\d+$/i)) {
            const seasonValue = String(row[key] || "").trim();
            if (seasonValue) {
                seasonEpisodes.push(seasonValue);
            }
        }
    }

    return seasonEpisodes.join("\n") || "";
}

// Debug helper to log row data structure
function logRowDebugInfo(row, index) {
    if (index === 0 || index === 1) { // Log first 2 rows only
        console.log(`=== ROW ${index} DEBUG ===`);
        console.log("Available columns:", Object.keys(row));
        console.log("Series Title:", getSeriesTitle(row));
        console.log("Episodes:", getEpisodesString(row));
        console.log("Full row data:", row);
    }
}

// Parse episodes string like "S01E01-10\nS02E01-13" into structured data
// Returns { seasonNumber: { start, end } } or {} if nothing parseable
function parseEpisodes(episodesStr) {
    if (!episodesStr) return {};

    const seasonMap = {};
    const lines = episodesStr.split(/[\n,]/).map(s => s.trim()).filter(s => s);

    for (const line of lines) {
        // Primary format:  S01E01-10
        let match = line.match(/S(\d+)E(\d+)[\-–](\d+)/i);
        if (match) {
            const season = parseInt(match[1], 10);
            seasonMap[season] = {
                start: parseInt(match[2], 10),
                end:   parseInt(match[3], 10),
            };
            continue;
        }
        // Fallback format: S01E10  (single episode — treat end = that ep number)
        match = line.match(/S(\d+)E(\d+)/i);
        if (match) {
            const season = parseInt(match[1], 10);
            const ep     = parseInt(match[2], 10);
            if (!seasonMap[season] || seasonMap[season].end < ep) {
                seasonMap[season] = { start: 1, end: ep };
            }
        }
    }

    return seasonMap;
}

// =====================
// RATE-LIMITED FETCH (no proxy needed: TVMaze's API sends its own CORS
// headers, so it can be called directly from the browser. We still pace
// and retry requests because TVMaze enforces its own rate limit: at least
// 20 calls / 10 seconds per IP, with HTTP 429 if you go over it.)
// =====================

// Minimum time between any two outgoing TVMaze requests, system-wide.
// TVMaze allows ~20 calls per 10 seconds. 300ms is slightly more aggressive
// but the exponential backoff handles 429s.
const TVMAZE_REQUEST_INTERVAL_MS = 300;
let nextAllowedRequestTime = 0;

function waitForRateLimitSlot() {
    return new Promise(resolve => {
        const now = Date.now();
        // If we are already past the next allowed time, we can go immediately.
        // Otherwise, we wait for the difference.
        const wait = Math.max(0, nextAllowedRequestTime - now);
        
        // Schedule the next slot immediately to maintain the cadence
        nextAllowedRequestTime = Math.max(now, nextAllowedRequestTime) + TVMAZE_REQUEST_INTERVAL_MS;
        
        setTimeout(resolve, wait);
    });
}

// Fetch a TVMaze API URL directly (no CORS proxy), automatically pacing
// requests and retrying with exponential backoff on HTTP 429.
async function fetchTVMazeDirect(targetUrl, retries = 4) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        await waitForRateLimitSlot();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        try {
            const response = await fetch(targetUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.status === 429) {
                const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s, 16s
                await new Promise(r => setTimeout(r, backoffMs));
                continue;
            }

            if (!response.ok) {
                throw new Error(`TVMaze request failed: ${response.status}`);
            }

            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            
            // Retry on network errors or timeouts
            if (attempt < retries) {
                const backoffMs = 1000 * Math.pow(2, attempt);
                const errorMsg = err.name === 'AbortError' 
                    ? 'Request timed out' 
                    : `Network error: ${err.message}`;
                console.warn(`TVMaze ${errorMsg}. Retrying in ${backoffMs}ms...`);
                await new Promise(r => setTimeout(r, backoffMs));
                continue;
            }
            throw err;
        }
    }

    throw new Error("TVMaze: maximum retries reached");
}

// Fetch series info from TVMaze
async function fetchTVMazeSeries(seriesTitle) {
    if (!seriesTitle) return null;

    if (
        tvmazeCache[seriesTitle] &&
        Date.now() - tvmazeCache[seriesTitle].timestamp < 86400000
    ) {
        return tvmazeCache[seriesTitle].data;
    }

    try {

        const searchData = await fetchTVMazeDirect(
            `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(seriesTitle)}`
        );

        if (!searchData.length) {
            return null;
        }

        const show = searchData[0].show;

        const episodes = await fetchTVMazeDirect(
            `https://api.tvmaze.com/shows/${show.id}/episodes`
        );

        const seasons = {};

        episodes.forEach(ep => {

            if (!ep.season || !ep.number) return;

            if (!seasons[ep.season]) {
                seasons[ep.season] = 0;
            }

            seasons[ep.season] = Math.max(
                seasons[ep.season],
                ep.number
            );

        });

        const result = {
            title: show.name,
            seasons,
            tvStatus: show.status || "",
            tvType: show.type || "",
            genres: Array.isArray(show.genres) ? show.genres.join(", ") : "",
            rating: (show.rating && show.rating.average) ? String(show.rating.average) : "",
        };

        tvmazeCache[seriesTitle] = {
            data: result,
            timestamp: Date.now()
        };

        localStorage.setItem(
            "tvmazeCache",
            JSON.stringify(tvmazeCache)
        );

        return result;

    } catch (err) {
        console.error(err);
        return null;
    }
}

// Compare local episodes with TVMaze data.
// Returns { status: "Complete"|"Has Missing"|"N/A", reasons: string[] }
// reasons is populated only when status === "Has Missing", e.g.:
//   ["S02: have E01-10, TVMaze has 13", "S03: fully missing (8 eps)"]
function calculateMissing(localEpisodes, tvmazeSeasons) {

    if (!tvmazeSeasons) {
        return { status: "N/A",reasons:["TVMaze: show not found"] };
    }

    const localMap = parseEpisodes(localEpisodes);
    const reasons = [];

    // Debug: if localMap is empty but we have episode data, the format isn't matching
    if (Object.keys(localMap).length === 0 && localEpisodes) {
        console.warn("[Missing] parseEpisodes returned empty for:", localEpisodes);
    }

    for (const [seasonStr, totalEpisodes] of Object.entries(tvmazeSeasons)) {

        const season = parseInt(seasonStr, 10);
        const label = `S${String(season).padStart(2, "0")}`;

        if (!localMap[season]) {
            reasons.push(`${label}: fully missing (${totalEpisodes} eps)`);
            continue;
        }

        if (localMap[season].end < totalEpisodes) {
            reasons.push(
                `${label}: have E01-${String(localMap[season].end).padStart(2, "0")}, ` +
                `TVMaze has ${totalEpisodes}`
            );
        }
    }

    return {
        status: reasons.length > 0 ? "Has Missing" : "Complete",
        reasons,
    };
}

// Get missing episodes for a row (async)
async function getMissingEpisodes(row) {
    const seriesTitle = getSeriesTitle(row);
    const episodesStr = getEpisodesString(row);

    if (!seriesTitle || !episodesStr) {
        return "N/A";
    }

    try {
        const tvmazeData = await fetchTVMazeSeries(seriesTitle);
        if (!tvmazeData) {
            return "N/A"; // TMDB data not found
        }

        return calculateMissing(
            episodesStr,
            tvmazeData.seasons
        );
    } catch (err) {
        console.error(`Error calculating missing for ${seriesTitle}:`, err);
        return "Error";
    }
}

function getRowValue(row, keys) {
    const lowerKeys = keys.map(k => k.toLowerCase());
    for (const key of Object.keys(row)) {
        if (lowerKeys.includes(key.toLowerCase()) && row[key] != null && String(row[key]).trim() !== "") {
            return String(row[key]).trim();
        }
    }
    return "";
}

function getSearchTitle(row) {
    const exactKeys = ["title", "Title", "Serial Name", "serial name", "Name", "name"];
    let title = getRowValue(row, exactKeys);
    if (title) return title;

    // fallback to any likely title/name field
    return getRowValue(row, [
        "movie",
        "film",
        "serial",
        "episode",
        "name",
        "title",
    ]);
}

function getRowStatus(row) {
    const status = getRowValue(row, ["status", "Status"]);
    return status.toLowerCase();
}

function getSearchButtonHTML(siteKey, title) {
    if (!title) return "";
    const site = SEARCH_SITES[siteKey];
    if (!site) return "";
    if (!site.url) return "";
    const href = `${site.url}${encodeURIComponent(title)}`;
    return `
        <a
            class="btn btn-sm btn-outline-success me-1 mb-1"
            target="_blank"
            rel="noopener noreferrer"
            href="${href}"
            title="Search ${site.label} for ${title}"
        >
            Download
        </a>
    `;
}

function normalizeRowValues(row) {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
        let normalizedValue = value;
        if (typeof normalizedValue === "string") {
            normalizedValue = normalizedValue.trim();
        }

        if (key.toLowerCase() === "type" && !normalizedValue) {
            normalizedValue = "Series";
        }

        normalized[key] = normalizedValue;
    }
    return normalized;
}

function renderSearchCell(row) {
    const status = getRowStatus(row);
    if (status !== "download") {
        return "";
    }

    const title = getSearchTitle(row);
    if (!title) {
        return "";
    }

    if (!CONFIG.site) {
        return Object.keys(SEARCH_SITES)
            .map(siteKey => getSearchButtonHTML(siteKey, title))
            .join("");
    }

    return getSearchButtonHTML(CONFIG.site, title);
}

// =====================
// LOAD EXCEL
// =====================
async function parseWorkbookBuffer(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheet = workbook.SheetNames[0];
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], {
        header: 1,
        defval: "",
    });

    const rawHeaders = rawRows[0] || [];
    const normalizedHeaders = normalizeHeaders(rawHeaders);

    return rawRows.slice(1).map(row => {
        const obj = {};
        normalizedHeaders.forEach((header, index) => {
            obj[header] = row[index] || "";
        });
        return normalizeRowValues(obj);
    });
}

async function loadExcelOnce() {
    if (Array.isArray(excelCache) && excelCache.length > 0) {
        excelCache = normalizeCachedData(excelCache);
        return excelCache;
    }

    const cached = normalizeCachedData(getExcelFromStorage());
    if (cached.length > 0) {
        excelCache = cached;
        return excelCache;
    }

    // Try automatic fetch first. 
    // Note: fetch() is blocked by CORS policy when using the file:// protocol.
    if (location.protocol !== 'file:') {
        const paths = ["./db/Data.xlsx", "db/Data.xlsx", "./db/data.xlsx", "db/data.xlsx"];
        for (const path of paths) {
            try {
                const response = await fetch(path);
                if (!response.ok) throw new Error(`Failed to load ${path} (${response.status})`);
                const arrayBuffer = await response.arrayBuffer();
                const jsonData = await parseWorkbookBuffer(arrayBuffer);
                const normalized = normalizeCachedData(jsonData);
                excelCache = normalized;
                localStorage.setItem("excelCache", JSON.stringify(normalized));
                console.log(`Successfully loaded Excel from ${path}`);
                return normalized;
            } catch (err) {
                console.warn(`Unable to load Excel from ${path}:`, err);
            }
        }
    } else {
        console.log("Running on file:// protocol. Automatic fetch is disabled due to browser CORS policy.");
    }

    console.error("Unable to automatically load local Excel data. Verify that ./db/Data.xlsx exists.");
    return [];
}

function getExcelFromStorage() {
    return JSON.parse(localStorage.getItem("excelCache") || "[]");
}

function normalizeHeaders(rawHeaders) {
    const normalized = [];
    const emptyHeaderRegex = /^__EMPTY(?:$|[_0-9].*)/i;
    const seasonHeaderRegex = /^Season$/i;
    let seasonCount = 0;

    for (const rawHeader of rawHeaders) {
        let header = String(rawHeader || "").trim();

        // If header is exactly "Season", treat it as Season01
        if (seasonHeaderRegex.test(header)) {
            seasonCount += 1;
            header = `Season${String(seasonCount).padStart(2, '0')}`;
        }
        // If header is empty or __EMPTY*, convert to Season##
        else if (!header || emptyHeaderRegex.test(header)) {
            seasonCount += 1;
            header = `Season${String(seasonCount).padStart(2, '0')}`;
        }

        const base = header;
        let suffix = 2;
        while (normalized.includes(header)) {
            header = `${base} ${suffix}`;
            suffix += 1;
        }

        normalized.push(header);
    }

    return normalized;
}

function normalizeCachedData(data) {
    if (!Array.isArray(data) || data.length === 0) return data;

    const rawHeaders = Object.keys(data[0]);
    const normalizedHeaders = normalizeHeaders(rawHeaders);

    const hasNormalization = rawHeaders.some((h, idx) => h !== normalizedHeaders[idx]);
    if (!hasNormalization) return data;

    return data.map(row => {
        const normalized = {};
        rawHeaders.forEach((key, index) => {
            normalized[normalizedHeaders[index]] = row[key];
        });
        return normalizeRowValues(normalized);
    });
}

// =====================
// URL SYNC
// =====================
function syncFromURL() {
    const params = new URLSearchParams(window.location.search);

    CONFIG.currentPage = parseInt(params.get("page")) || 1;

    // rows per page from URL (rpp)
    const rpp = parseInt(params.get("rpp"));
    if (!Number.isNaN(rpp) && rpp > 0) CONFIG.rowsPerPage = rpp;

    CONFIG.site = params.get("site") || "";
    CONFIG.missing = params.get("missing") || "";

    const statusEl = document.getElementById("statusFilter");
    const typeEl = document.getElementById("typeFilter");
    const siteEl = document.getElementById("siteFilter");
    const missingEl = document.getElementById("missingFilter");
    if (statusEl) statusEl.value = params.get("status") || "";
    if (typeEl) typeEl.value = params.get("type") || "";
    if (siteEl) siteEl.value = CONFIG.site;
    if (missingEl) missingEl.value = CONFIG.missing;
}

function updateURL() {
    const params = new URLSearchParams();

    params.set("page", CONFIG.currentPage);

    const status = document.getElementById("statusFilter")?.value;
    const type = document.getElementById("typeFilter")?.value;
    const site = document.getElementById("siteFilter")?.value;
    const missing = document.getElementById("missingFilter")?.value;
    const rpp = CONFIG.rowsPerPage;

    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (site) params.set("site", site);
    if (missing) params.set("missing", missing);
    if (rpp) params.set("rpp", String(rpp));

    window.history.replaceState({}, "", `?${params.toString()}`);
}

// =====================
// CORE FILTER ENGINE
// =====================
function applyAll() {
    const status = document.getElementById("statusFilter")?.value || "";
    const type = document.getElementById("typeFilter")?.value || "";
    const typeDiff = document.getElementById("typeDiffFilter")?.value || "";
    const missing = document.getElementById("missingFilter")?.value || "";
    const tvStatus = document.getElementById("tvStatusFilter")?.value || "";
    const showType = document.getElementById("showTypeFilter")?.value || "";
    const genres = document.getElementById("genresFilter")?.value || "";
    const rating = document.getElementById("ratingFilter")?.value || "";

    CONFIG.filteredData = CONFIG.data.filter((item, index) => {
        const statusMatch = status ? item.Status === status : true;
        const typeMatch = type ? item.Type === type : true;

        const searchMatch = CONFIG.search
            ? Object.values(item).join(" ").toLowerCase().includes(CONFIG.search)
            : true;

        // Filter by missing status
        let missingMatch = true;
        if (missing) {
            const title = Object.values(item).find(v => typeof v === "string") || "";
            const seriesTitle = getSeriesTitle(item);

            const cachedEntry = missingValuesMap[seriesTitle];
            const rowMissingValue = cachedEntry
                ? (typeof cachedEntry === "string" ? cachedEntry : cachedEntry.status)
                : "";
            if (missing === "Has Missing") {
                missingMatch = rowMissingValue === "Has Missing";
            } else {
                missingMatch = rowMissingValue === missing;
            }
        }

        // TVMaze info filters
        let tvStatusMatch = true;
        let showTypeMatch = true;
        let genresMatch = true;
        let ratingMatch = true;
        let typeDiffMatch = true;
        if (tvStatus || showType || genres || rating || typeDiff) {
            const seriesTitle = getSeriesTitle(item);
            const cached = tvmazeCache[seriesTitle];
            const tvData = (cached && cached.data) ? cached.data : null;

            if (tvStatus) tvStatusMatch = tvData ? tvData.tvStatus === tvStatus : false;
            if (showType) showTypeMatch = tvData ? tvData.tvType === showType : false;
            if (genres) genresMatch = tvData ? (tvData.genres || "").toLowerCase().includes(genres.toLowerCase()) : false;
            if (rating) {
                const r = parseFloat(tvData ? tvData.rating : "");
                const filterR = parseFloat(rating);
                ratingMatch = !isNaN(r) && !isNaN(filterR) ? r >= filterR : false;
            }
            if (typeDiff) {
                if (!tvData) {
                    typeDiffMatch = typeDiff === "n/a";
                } else {
                    const status = tvData.tvStatus || "";
                    const type = tvData.tvType || "";
                    const cachedEntry = missingValuesMap[seriesTitle];
                    const rowMissingValue = cachedEntry ? (typeof cachedEntry === "string" ? cachedEntry : cachedEntry.status) : "";
                    const isComplete = (status === "Finished" || status === "Ended" || type === "Ended") || rowMissingValue === "Complete";
                    if (typeDiff === "Complete") typeDiffMatch = isComplete;
                    else if (typeDiff === "Attention") typeDiffMatch = !isComplete;
                    else if (typeDiff === "n/a") typeDiffMatch = false;
                }
            }
        }

        return statusMatch && typeMatch && searchMatch && missingMatch &&
               tvStatusMatch && showTypeMatch && genresMatch && ratingMatch && typeDiffMatch;
    });

    if (CONFIG.sortKey) applySort();
}

// =====================
// SORT
// =====================
function applySort() {
    const key = CONFIG.sortKey;
    if (!key) return;

    CONFIG.filteredData.sort((a, b) => {
        const valA = String(a[key] || "").toLowerCase();
        const valB = String(b[key] || "").toLowerCase();

        if (valA < valB) return CONFIG.sortOrder === "asc" ? -1 : 1;
        if (valA > valB) return CONFIG.sortOrder === "asc" ? 1 : -1;
        return 0;
    });
}

function toggleSort(key) {
    if (CONFIG.sortKey === key) {
        CONFIG.sortOrder = CONFIG.sortOrder === "asc" ? "desc" : "asc";
    } else {
        CONFIG.sortKey = key;
        CONFIG.sortOrder = "asc";
    }

    CONFIG.currentPage = 1;

    applySort();
    refreshUI();
}

// =====================
// TABLE RENDER
// =====================
function refreshUI() {
    applyAll();
    renderTableHead();
    renderTable();
    renderPagination();
}

function renderTableHead() {
    const headRow = CONFIG.tableHead;
    if (!headRow) return;

    headRow.innerHTML = "";
    const columnsToRender = getColumnsToRender();

    columnsToRender.forEach(col => {
        const th = document.createElement("th");
        th.textContent = col;

        if (col === "Serial Name") {
            th.style.cursor = "pointer";
            th.classList.add("sortable");
            const indicator = document.createElement("span");
            indicator.style.marginLeft = "6px";
            if (CONFIG.sortKey === "Serial Name") indicator.textContent = CONFIG.sortOrder === "asc" ? "↑" : "↓";
            th.appendChild(indicator);
            th.addEventListener("click", () => toggleSort("Serial Name"));
        }

        headRow.appendChild(th);
    });
}


// Render a single Missing-column cell. If the value is already known (cache
// hit from a previous resolution), show it immediately -- this is what stops
// "Loading..." from reappearing forever once the loader has already finished
// for that series, e.g. after changing page, sorting, or filtering.

// =====================
// MISSING BADGE RENDERER
// =====================

// Accepts a {status, reasons} object (or plain string for back-compat) and
// an optional row object. Returns the badge + tooltip + popover HTML.
// When status === "Has Missing", download buttons are appended inside the popover.
function missingBadgeHTML(entry, row) {
    // Back-compat: plain strings from old localStorage cache
    if (typeof entry === "string") {
        entry = { status: entry, reasons: ["."] };
    }

    const { status, reasons } = entry;

    const badgeCls = {
        "Complete":    "rounded-pill text-bg-success",
        "Has Missing": "rounded-pill text-bg-warning",
        "N/A":         "rounded-pill text-bg-info",
        "Error":       "rounded-pill text-bg-danger",
    }[status] || "bg-secondary";

    // Tooltip: one-line summary shown on hover
    const tooltipText = reasons.length
        ? reasons.join(" | ")
        : status;

    if (!reasons.length) {
        // No detail to show — just a plain badge with tooltip
        return `<span class="badge ${badgeCls}"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="${tooltipText.replace(/"/g, "&quot;")}"
            style="cursor:default">${status}</span>`;
    }

    // Reasons table
    const reasonRows = reasons
        .map(r => `<tr><td style="white-space:nowrap;padding:2px 6px">${r}</td></tr>`)
        .join("");
    let popoverContent = `<table class="table mb-0">${reasonRows}</table>`;

    // Download buttons — only for "Has Missing" rows when we have a row object
    if (status === "Has Missing" && row) {
        const title = getSearchTitle(row);
        if (title) {
            const activeSites = CONFIG.site
                ? [CONFIG.site]
                : Object.keys(SEARCH_SITES);

            const btns = activeSites
                .map(key => {
                    const site = SEARCH_SITES[key];
                    if (!site || !site.url) return "";
                    const href = `${site.url}${encodeURIComponent(title)}`;
                    return `<a href="${href}" target="_blank" rel="noopener noreferrer"
                        class="btn btn-sm btn-outline-success me-1 mt-1">${site.label}</a>`;
                })
                .join("");

            if (btns) {
                popoverContent +=
                    `<hr class="my-2">` +
                    `<div class="d-flex flex-wrap">${btns}</div>`;
            }
        }
    }

    return `<span class="badge ${badgeCls} missing-detail-badge"
        data-bs-toggle="popover"
        data-bs-trigger="click"
        data-bs-placement="bottom"
        data-bs-html="true"
         data-bs-title="${tooltipText.replace(/\|/g, "<br>")}"
        data-bs-content="${popoverContent.replace(/"/g, "&quot;")}"
        title="${tooltipText.replace(/"/g, "&quot;")}"
        style="cursor:pointer"> <i class="bi bi-exclamation-triangle me-1"></i>${status} </span>`;
}

// Init Bootstrap tooltips + popovers on all missing badges in the DOM.
// Called after every table render.
function initMissingBadgeInteractivity() {
    // Destroy existing instances first to avoid duplicates
    document.querySelectorAll(".missing-detail-badge").forEach(el => {
        const pop = bootstrap.Popover.getInstance(el);
        if (pop) pop.dispose();
    });
    document.querySelectorAll("[data-bs-toggle='tooltip']").forEach(el => {
        const tt = bootstrap.Tooltip.getInstance(el);
        if (tt) tt.dispose();
        new bootstrap.Tooltip(el);
    });
    // Close any open popover when clicking outside
    document.querySelectorAll(".missing-detail-badge").forEach(el => {
        new bootstrap.Popover(el);
    });
    document.addEventListener("click", e => {
        if (!e.target.closest(".missing-detail-badge") && !e.target.closest(".popover")) {
            document.querySelectorAll(".missing-detail-badge").forEach(el => {
                const pop = bootstrap.Popover.getInstance(el);
                if (pop) pop.hide();
            });
        }
    }, { capture: true, once: false });
}

function renderMissingCell(row) {
    const seriesTitle = getSeriesTitle(row);
    const safeSeries = seriesTitle.replace(/"/g, '"');
    const safeEpisodes = getEpisodesString(row).replace(/"/g, '"');
    const cachedEntry = missingValuesMap[seriesTitle];

    const content = cachedEntry
        ? missingBadgeHTML(cachedEntry, row)
        : `<span class="missing-loading text-muted small">Loading...</span>`;

    return `<td class="missing-cell" data-series="${safeSeries}" data-episodes="${safeEpisodes}">${content}</td>`;
}

function renderStatusDiffCell(row) {
    const seriesTitle = getSeriesTitle(row);
    const cached = tvmazeCache[seriesTitle];
    const tvData = (cached && cached.data) ? cached.data : null;

    if (!tvData) {
        return `<td class="status-diff-cell" data-series="${seriesTitle.replace(/"/g, '"')}">
            <span class="badge rounded-pill text-bg-info">n/a</span>
        </td>`;
    }

    const excelStatus = getRowStatus(row);
    const tvStatus = tvData.tvStatus || "";

    let result = { label: "Complete", cls: "text-bg-success" };

    if (excelStatus === "finished") {
        if (tvStatus === "Ended") {
            result = { label: "Complete", cls: "text-bg-success" };
        } else {
            result = { label: "Attention", cls: "text-bg-danger" };
        }
    } else if (excelStatus === "ongoing") {
        if (tvStatus === "Ended") {
            result = { label: "Attention", cls: "text-bg-danger" };
        } else {
            result = { label: "Complete", cls: "text-bg-success" };
        }
    } else if (excelStatus === "") {
        result = { label: "n/a", cls: "text-bg-info" };
    }

    return `<td class="status-diff-cell" data-series="${seriesTitle.replace(/"/g, '"')}">
        <span class="badge rounded-pill ${result.cls}">${result.label}</span>
    </td>`;
}

function renderTable() {
    const tbody = CONFIG.tableBody;
    if (!tbody) return;

    const start = (CONFIG.currentPage - 1) * CONFIG.rowsPerPage;
    const end = start + CONFIG.rowsPerPage;

    const pageData = CONFIG.filteredData.slice(start, end);
    const columnsToRender = getColumnsToRender();

    tbody.innerHTML = pageData
        .map((row, rowIndex) => `
            <tr data-row-index="${start + rowIndex}">
                ${columnsToRender
                .map(col => {
                    if (col === "Download") {
                        return `<td>${renderSearchCell(row)}</td>`;
                    }
                    if (col === "Missing") {
                        return renderMissingCell(row);
                    }
                    if (col === "Status Diff") {
                        return renderStatusDiffCell(row);
                    }
                    if (col === "Read more") {
                        const absoluteIndex = CONFIG.data.indexOf(row);
                        return `<td><a href="details.html?id=${absoluteIndex}" class="btn btn-sm btn-success">Read more</a></td>`;
                    }
                    if (col === "Status Tv" || col === "Show Type" || col === "Genres" || col === "Rating") {
                        return renderTVMazeCell(row, col);
                    }
                    return `<td>${row[col] || ""}</td>`;
                })
                .join("")}
            </tr>
        `)
        .join("");

    // Load missing episodes asynchronously for visible cells
    loadMissingEpisodesForVisibleCells();
    initMissingBadgeInteractivity();
}

// =====================
// MISSING EPISODES LOADER (optimized: incremental DOM updates + limited concurrency)
// =====================

// Series titles currently being fetched, to avoid duplicate concurrent requests
const missingFetchInFlight = new Set();

// Guards against multiple overlapping "scan the whole dataset" passes
let missingBackgroundLoaderRunning = false;

// --- Diagnostics: lets you check from the console whether the loader is
// actually making progress or stuck/broken, instead of just staring at
// "Loading..." with no idea what's happening underneath. ---
const missingLoaderStats = {
    resolvedCount: 0,   // distinct series resolved so far (any outcome)
    errorCount: 0,
    lastProgressAt: Date.now(),
    startedAt: Date.now(),
};

// Total distinct series titles that exist in the loaded sheet. Computed once
// the data is loaded (see init()) so progress % is meaningful.
let missingLoaderTotalSeries = 0;

function updateMissingProgressBar() {
    const resolved = Object.keys(missingValuesMap).length;
    const total = missingLoaderTotalSeries || 0;

    const percent = total
        ? Math.round((resolved / total) * 100)
        : 0;

    const progressBar = document.getElementById("missingProgressBar");

    if (!progressBar) return;

    progressBar.style.width = `${percent}%`;
    progressBar.textContent = `${percent}%`;
    progressBar.setAttribute("aria-valuenow", percent);

    if (percent >= 100) {
        progressBar.classList.remove(
            "progress-bar-striped",
            "progress-bar-animated"
        );
    }
}

function getMissingLoaderStatus() {
    const resolved = Object.keys(missingValuesMap).length;
    const secondsSinceProgress = Math.round((Date.now() - missingLoaderStats.lastProgressAt) / 1000);
    return {
        resolved,
        total: missingLoaderTotalSeries,
        pending: Math.max(0, missingLoaderTotalSeries - resolved),
        errors: missingLoaderStats.errorCount,
        secondsSinceLastProgress: secondsSinceProgress,
        likelyStuck: secondsSinceProgress > 30 && resolved < missingLoaderTotalSeries,
    };
}
window.getMissingLoaderStatus = getMissingLoaderStatus;

function logMissingLoaderProgress() {
    const s = getMissingLoaderStatus();
    missingLoaderStats.lastProgressAt = Date.now();
    updateMissingProgressBar()
    // Log every 10 resolutions (not every single one) to avoid flooding the console.
    // if (s.resolved % 10 === 0 || s.pending === 0) {
    //     const pct = s.total ? Math.round((s.resolved / s.total) * 100) : 0;
    //     console.log(`[Missing Loader] ${s.resolved}/${s.total} series resolved (${pct}%)${s.pending === 0 ? " — done." : ""}`);
    // }
}

// Watchdog: if nothing has changed in 30s while work is still pending,
// say so explicitly instead of leaving you guessing whether it's stuck.
setInterval(() => {
    const s = getMissingLoaderStatus();
    if (s.likelyStuck) {
        console.warn(
            `[Missing Loader] No progress in ${s.secondsSinceLastProgress}s. ` +
            `${s.pending} series still pending. Check the Network tab for requests to ` +
            `api.tvmaze.com that are failing/blocked — that's the actual cause if you see this.`
        );
    }
}, 15000);

// Push a freshly computed value straight into any matching cell(s) on screen.
// This is what actually fixes the "stuck on Loading..." problem: previously the
// DOM was only updated once *all* ~800 rows had been processed.
function updateMissingCellInDOM(seriesTitle, entry) {
    const safeTitle = (seriesTitle || "").replace(/"/g, '\\"');
    const cells = document.querySelectorAll(`.missing-cell[data-series="${safeTitle}"]`);
    // Find the matching row object so missingBadgeHTML can render download buttons
    const matchedRow = CONFIG.data.find(r => getSeriesTitle(r) === seriesTitle) || null;
    cells.forEach(cell => {
        cell.innerHTML = missingBadgeHTML(entry, matchedRow);
    });
    initMissingBadgeInteractivity();
}

// Resolve (and cache) the missing-episodes value for a single row, then
// immediately reflect it in the DOM if that row is currently visible.
async function resolveMissingForRow(row) {
    const seriesTitle = getSeriesTitle(row);

    // Rows with no title we can match to a series can never be looked up on
    // TVMaze. Previously these rows were skipped entirely, which left their
    // cell stuck on "Loading..." forever. Resolve them immediately instead.
    if (!seriesTitle) {
        if (missingValuesMap[""] !== "N/A") {
            missingValuesMap[""] = { status: "N/A", reasons:["Missing series title"] };
            updateMissingCellInDOM("", { status: "N/A", reasons: ["Missing series title"] });
        }
        return;
    }

    // Already known: just make sure the DOM reflects it (covers any cell that
    // was rendered before this value got cached) and stop -- no network call.
    if (missingValuesMap[seriesTitle]) {
        updateMissingCellInDOM(seriesTitle, missingValuesMap[seriesTitle]);
        return;
    }

    if (missingFetchInFlight.has(seriesTitle)) {
        return;
    }

    missingFetchInFlight.add(seriesTitle);

    try {
        const episodesStr = getEpisodesString(row);

        if (!episodesStr) {
            missingValuesMap[seriesTitle] = { status: "N/A", reasons:["No episode data"] };
            return;
        }

        const tvmazeData = await fetchTVMazeSeries(seriesTitle);

        missingValuesMap[seriesTitle] = tvmazeData
            ? calculateMissing(episodesStr, tvmazeData.seasons)
            : { status: "N/A", reasons: ["TVMaze: show not found"] };

    } catch {
        missingValuesMap[seriesTitle] = { status: "Error", reasons: ["Failed to fetch TVMaze data"] };
        missingLoaderStats.errorCount++;
    } finally {
        missingFetchInFlight.delete(seriesTitle);
        updateMissingCellInDOM(seriesTitle, missingValuesMap[seriesTitle]);
        updateTVInfoCellsInDOM(seriesTitle);
        logMissingLoaderProgress();
    }
}

// Process a list of rows with a worker pool.
// Several TVMaze lookups are queued; the rate limiter ensures we stay within API limits.
async function processRowsWithConcurrency(rows, concurrency = 10) {
    let cursor = 0;

    async function worker() {
        while (cursor < rows.length) {
            const row = rows[cursor++];
            await resolveMissingForRow(row);
        }
    }

    const workerCount = Math.max(1, Math.min(concurrency, rows.length));
    await Promise.all(Array.from({ length: workerCount }, worker));

    localStorage.setItem(
        "missingValuesMap",
        JSON.stringify(missingValuesMap)
    );
}

// Load missing episodes: the rows on the *current page* are resolved first
// (so the user sees real values quickly instead of "Loading..."), then the
// rest of the filtered dataset is resolved in the background, in batches,
// without blocking the UI or re-scanning rows that are already cached.
async function loadMissingEpisodesForVisibleCells() {
    const start = (CONFIG.currentPage - 1) * CONFIG.rowsPerPage;
    const end = start + CONFIG.rowsPerPage;
    const visibleRows = CONFIG.filteredData.slice(start, end);

    // 1) Fast path: resolve what the user can actually see right now.
    await processRowsWithConcurrency(visibleRows, 5);

    // 2) Background path: fill in the rest of the filtered rows so that
    //    filtering/sorting by "Missing" keeps working across the whole sheet.
    //    Guarded so navigating pages quickly doesn't spawn N overlapping scans.
    if (missingBackgroundLoaderRunning) return;
    missingBackgroundLoaderRunning = true;

    try {
        const remainingRows = CONFIG.filteredData.filter(row => {
            const title = getSeriesTitle(row);
            // Untitled rows are always retried (cheap no-op once resolved);
            // titled rows are retried only while still uncached.
            return title ? !missingValuesMap[title] : missingValuesMap[""] !== "N/A";
        });

        await processRowsWithConcurrency(remainingRows, 10);
    } finally {
        missingBackgroundLoaderRunning = false;
    }
}


// =====================
// PAGINATION
// =====================
function getTotalPages() {
    return Math.ceil(CONFIG.filteredData.length / CONFIG.rowsPerPage) || 1;
}

function renderPagination() {
    const container = CONFIG.pagination;
    if (!container) return;

    const total = getTotalPages();
    const current = CONFIG.currentPage;

    // clear
    container.innerHTML = "";

    function createPageItem(label, disabled, active, onClick) {
        const li = document.createElement("li");
        li.className = `page-item ${disabled ? "disabled" : ""} ${active ? "active" : ""}`.trim();
        const btn = document.createElement("button");
        btn.className = "page-link";
        btn.textContent = label;
        btn.disabled = !!disabled;
        if (!disabled && onClick) btn.addEventListener("click", onClick);
        li.appendChild(btn);
        return li;
    }
    container.appendChild(createPageItem("Prev", current === 1, false, () => changePage(current - 1)));

    // Build pages with intelligent ellipses. Always show first and last.
    const pages = [];
    if (total <= 7) {
        for (let i = 1; i <= total; i++) pages.push(i);
    } else {
        pages.push(1);

        let start = Math.max(2, current - 1);
        let end = Math.min(total - 1, current + 1);

        if (start > 2) pages.push("left-ellipsis");

        for (let p = start; p <= end; p++) pages.push(p);

        if (end < total - 1) pages.push("right-ellipsis");

        pages.push(total);
    }

    pages.forEach(p => {
        if (p === "left-ellipsis" || p === "right-ellipsis") {
            const li = document.createElement("li");
            li.className = "page-item disabled";
            const span = document.createElement("span");
            span.className = "page-link";
            span.textContent = "...";
            li.appendChild(span);
            container.appendChild(li);
        } else {
            container.appendChild(createPageItem(p, false, p === current, () => changePage(p)));
        }
    });

    container.appendChild(createPageItem("Next", current === total, false, () => changePage(current + 1)));
}

function changePage(page) {
    const total = getTotalPages();
    if (page < 1 || page > total) return;

    CONFIG.currentPage = page;

    updateURL();

    renderTable();
    renderPagination();
}

// =====================
// CLEAR FILTERS
// =====================
function clearCache() {
    const customSiteUrl = localStorage.getItem("customSiteUrl");
    localStorage.clear();
    if (customSiteUrl) {
        localStorage.setItem("customSiteUrl", customSiteUrl);
    }
    location.reload();
}

function clearFilters() {
    const statusEl = document.getElementById("statusFilter");
    const typeEl = document.getElementById("typeFilter");
    const typeDiffEl = document.getElementById("typeDiffFilter");
    const siteEl = document.getElementById("siteFilter");
    const missingEl = document.getElementById("missingFilter");
    const searchEl = document.getElementById("searchInput");
    const rowsSelect = document.getElementById("rowsPerPageSelect");
    const tvStatusEl = document.getElementById("tvStatusFilter");
    const showTypeEl = document.getElementById("showTypeFilter");
    const genresEl = document.getElementById("genresFilter");
    const ratingEl = document.getElementById("ratingFilter");

    if (statusEl) statusEl.value = "";
    if (typeEl) typeEl.value = "";
    if (typeDiffEl) typeDiffEl.value = "";
    if (siteEl) {
        siteEl.value = "";
        CONFIG.site = "";
    }
    if (missingEl) {
        missingEl.value = "";
        CONFIG.missing = "";
    }
    if (searchEl) {
        searchEl.value = "";
        CONFIG.search = "";
    }
    if (tvStatusEl) tvStatusEl.value = "";
    if (showTypeEl) showTypeEl.value = "";
    if (genresEl) genresEl.value = "";
    if (ratingEl) ratingEl.value = "";

    // reset to first page
    CONFIG.currentPage = 1;

    // keep rowsPerPage as-is (reflect in select)
    if (rowsSelect) rowsSelect.value = String(CONFIG.rowsPerPage || 10);

    // reapply filters and update UI
    refreshUI();

    // update URL to minimal state (page + rpp)
    const params = new URLSearchParams();
    params.set('page', CONFIG.currentPage);
    if (CONFIG.rowsPerPage) params.set('rpp', String(CONFIG.rowsPerPage));
    window.history.replaceState({}, '', `?${params.toString()}`);
}

// =====================
// BOOT / INIT
// =====================
let searchTimeout;

async function init({ rowsPerPage = 10 } = {}) {
    CONFIG.rowsPerPage = rowsPerPage;

    CONFIG.tableBody = document.getElementById("tableBody");
    CONFIG.tableHead = document.getElementById("tableHead");
    CONFIG.pagination = document.getElementById("pagination");

    // Load TVMaze cache from localStorage
    tvmazeCache = JSON.parse(
        localStorage.getItem("tvmazeCache")
    ) || {};

    // Clear old missingValuesMap cache if it contains plain strings (pre-reasons format).
    // This forces a fresh lookup so reasons get populated correctly.
    const rawMissingCache = JSON.parse(localStorage.getItem("missingValuesMap") || "{}");
    const hasOldFormat = Object.values(rawMissingCache).some(v => typeof v === "string");
    if (hasOldFormat) {
        console.log("[Missing] Old string-format cache detected — clearing to rebuild with reasons.");
        localStorage.removeItem("missingValuesMap");
        Object.keys(missingValuesMap).forEach(k => delete missingValuesMap[k]);
    }

    SEARCH_SITES.custom.url =
        localStorage.getItem("customSiteUrl") || "";

    // Load Excel and get normalized data directly
    const loadedData = await loadExcelOnce();
    CONFIG.data = Array.isArray(loadedData) ? loadedData : [];
    console.log(
        "Missing cache:",
        Object.keys(missingValuesMap).length,
        "items"
    );

    // For the "X/Y resolved" progress diagnostics in the Missing loader.
    missingLoaderTotalSeries = new Set(CONFIG.data.map(getSeriesTitle)).size;

    CONFIG.columns = Object.keys(CONFIG.data[0] || {}).filter(col => col !== "Search" && col !== "Download");

    // Debug: Log data structure
    // console.log("=== EXCEL DATA LOADED ===");
    // console.log("Total rows:", CONFIG.data.length);
    // console.log("Available columns:", CONFIG.columns);
    // if (CONFIG.data.length > 0) {
    //     console.log("First row:", CONFIG.data[0]);
    //     logRowDebugInfo(CONFIG.data[0], 0);
    //     if (CONFIG.data.length > 1) logRowDebugInfo(CONFIG.data[1], 1);
    // }

    syncFromURL();

    // Sync all filter select elements to reflect URL parameters
    const statusFilterEl = document.getElementById("statusFilter");
    const typeFilterEl = document.getElementById("typeFilter");
    const siteFilterEl = document.getElementById("siteFilter");
    const missingFilterEl = document.getElementById("missingFilter");

    const urlParams = new URLSearchParams(window.location.search);
    if (statusFilterEl) statusFilterEl.value = urlParams.get("status") || "";
    if (typeFilterEl) typeFilterEl.value = urlParams.get("type") || "";
    if (siteFilterEl) siteFilterEl.value = urlParams.get("site") || "";
    if (missingFilterEl) missingFilterEl.value = urlParams.get("missing") || "";

    // wire inputs
    // rows per page control
    const rowsSelect = document.getElementById("rowsPerPageSelect");
    if (rowsSelect) {
        // set initial from URL/CONFIG
        rowsSelect.value = String(CONFIG.rowsPerPage);
        rowsSelect.addEventListener("change", (e) => {
            const v = parseInt(e.target.value) || 10;
            CONFIG.rowsPerPage = v;
            CONFIG.currentPage = 1;
            updateURL();
            refreshUI();
        });
    }

    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                CONFIG.search = e.target.value.toLowerCase();
                CONFIG.currentPage = 1;
                refreshUI();
            }, 250);
        });
    }

    const statusFilter = document.getElementById("statusFilter");
    if (statusFilter) statusFilter.addEventListener("change", () => {
        CONFIG.currentPage = 1;
        updateURL();
        refreshUI();
    });

    const typeFilter = document.getElementById("typeFilter");
    if (typeFilter) typeFilter.addEventListener("change", () => {
        CONFIG.currentPage = 1;
        updateURL();
        refreshUI();
    });

    const typeDiffFilter = document.getElementById("typeDiffFilter");
    if (typeDiffFilter) typeDiffFilter.addEventListener("change", () => {
        CONFIG.currentPage = 1;
        updateURL();
        refreshUI();
    });

    const siteFilter = document.getElementById("siteFilter");
    if (siteFilter) siteFilter.addEventListener("change", () => {
        CONFIG.site = siteFilter.value;
        CONFIG.currentPage = 1;
        updateURL();
        refreshUI();
    });

    const customSiteInput =
        document.getElementById("customSiteInput");

    if (customSiteInput) {

        customSiteInput.value =
            SEARCH_SITES.custom.url;

        customSiteInput.addEventListener("input", () => {

            SEARCH_SITES.custom.url =
                customSiteInput.value.trim();

            localStorage.setItem(
                "customSiteUrl",
                SEARCH_SITES.custom.url
            );

            renderTable();
        });
    }

    const missingFilter = document.getElementById("missingFilter");
    if (missingFilter) missingFilter.addEventListener("change", () => {
        CONFIG.missing = missingFilter.value;
        CONFIG.currentPage = 1;
        updateURL();
        refreshUI();
    });

    // TVMaze info filters
    ["tvStatusFilter", "showTypeFilter", "genresFilter", "ratingFilter"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", () => {
            CONFIG.currentPage = 1;
            refreshUI();
        });
    });

    const clearBtn = document.getElementById("clearFiltersBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            clearFilters();
        });
    }

    const clearCacheBtn = document.getElementById("clearCacheBtn");
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener("click", () => {
            if (confirm("Are you sure you want to clear all cached data? This will remove saved Excel data and TVMaze info.")) {
                clearCache();
            }
        });
    }

    // initial render
    refreshUI();

    loadMissingEpisodesForVisibleCells();
    updateMissingProgressBar();
}


window.CONFIG = CONFIG;
window.init = init;
window.clearFilters = clearFilters;
window.clearCache = clearCache;
window.toggleSort = toggleSort;
window.changePage = changePage;
window.renderPagination = renderPagination;
window.renderTable = renderTable;
window.applyAll = applyAll;