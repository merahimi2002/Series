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
let missingValuesMap = {};

const SEARCH_SITES = {
    digimoviez: {
        label: "DigiMoviez",
        url: "https://digimoviez.com/?s=",
    },
    f2my: {
        label: "F2MY",
        url: "https://www.f2my.top/?s=",
    },
};

// =====================
// TMDB INTEGRATION
// =====================
const TMDB_API_KEY = "0b35a2b2cfe90d204598249dcab395bb"; // Public readonly key
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

// Cache for TMDB results: { "Series Title": { seasons: {...}, timestamp: ... } }
let tmdbCache = {};

// Helper to get series title for TMDB lookup
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
function parseEpisodes(episodesStr) {
    if (!episodesStr) return {};

    const seasonMap = {};
    const lines = episodesStr.split(/[\n,]/).map(s => s.trim()).filter(s => s);

    for (const line of lines) {
        const match = line.match(/S(\d+)E(\d+)-(\d+)/i);
        if (match) {
            const season = parseInt(match[1], 10);
            const start = parseInt(match[2], 10);
            const end = parseInt(match[3], 10);
            seasonMap[season] = { start, end };
        }
    }

    return seasonMap;
}

// Fetch series info from TMDB
async function fetchTMDBSeries(seriesTitle) {
    if (!seriesTitle) {
        console.log("fetchTMDBSeries: Empty series title");
        return null;
    }

    console.log(`fetchTMDBSeries: Fetching "${seriesTitle}"`);

    // Check cache first
    if (tmdbCache[seriesTitle] && Date.now() - tmdbCache[seriesTitle].timestamp < 24 * 60 * 60 * 1000) {
        console.log(`fetchTMDBSeries: "${seriesTitle}" found in cache`);
        return tmdbCache[seriesTitle].data;
    }

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(seriesTitle)}`
        );
        if (!response.ok) throw new Error(`TMDB API error: ${response.status}`);

        const data = await response.json();
        if (!data.results || data.results.length === 0) {
            console.log(`fetchTMDBSeries: "${seriesTitle}" not found in TMDB`);
            tmdbCache[seriesTitle] = { data: null, timestamp: Date.now() };
            localStorage.setItem("tmdbCache", JSON.stringify(tmdbCache));
            return null;
        }

        const series = data.results[0];
        const seriesId = series.id;

        // Fetch season/episode counts
        const detailResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${seriesId}?api_key=${TMDB_API_KEY}`
        );
        if (!detailResponse.ok) throw new Error(`TMDB detail API error: ${detailResponse.status}`);

        const detailData = await detailResponse.json();
        const seasons = {};

        // Build season map from TMDB data
        if (detailData.seasons) {
            for (const season of detailData.seasons) {
                if (season.season_number > 0) { // Skip season 0 (specials)
                    seasons[season.season_number] = season.episode_count || 0;
                }
            }
        }

        const result = { seasons, title: series.name };
        tmdbCache[seriesTitle] = { data: result, timestamp: Date.now() };
        localStorage.setItem("tmdbCache", JSON.stringify(tmdbCache));
        return result;
    } catch (err) {
        console.warn(`Failed to fetch TMDB data for "${seriesTitle}":`, err);
        return null;
    }
}

// Compare local episodes with TMDB data and generate missing string
function calculateMissing(localEpisodes, tmdbSeasons) {
    if (!tmdbSeasons || Object.keys(tmdbSeasons).length === 0) {
        return "Unknown"; // Can't determine missing if TMDB data unavailable
    }

    const localMap = parseEpisodes(localEpisodes);
    const missing = [];

    // Find missing episodes at end of seasons
    for (const [seasonStr, episodeCount] of Object.entries(tmdbSeasons)) {
        const season = parseInt(seasonStr, 10);
        const localSeason = localMap[season];

        if (!localSeason) {
            // Entire season is missing
            missing.push(`S${String(season).padStart(2, '0')}E01-${episodeCount}`);
        } else if (localSeason.end < episodeCount) {
            // Missing episodes at end of season
            const startMissing = localSeason.end + 1;
            missing.push(`S${String(season).padStart(2, '0')}E${String(startMissing).padStart(2, '0')}-${episodeCount}`);
        }
    }

    // Find missing entire seasons (seasons after last local season)
    if (Object.keys(localMap).length > 0) {
        const maxLocalSeason = Math.max(...Object.keys(localMap).map(Number));
        const maxTMDBSeason = Math.max(...Object.keys(tmdbSeasons).map(Number));

        for (let season = maxLocalSeason + 1; season <= maxTMDBSeason; season++) {
            const episodeCount = tmdbSeasons[season];
            if (episodeCount) {
                missing.push(`S${String(season).padStart(2, '0')}E01-${episodeCount}`);
            }
        }
    }

    return missing.length === 0 ? "Complete" : missing.join(", ");
}

// Get missing episodes for a row (async)
async function getMissingEpisodes(row) {
    const seriesTitle = getSeriesTitle(row);
    const episodesStr = getEpisodesString(row);

    if (!seriesTitle || !episodesStr) {
        return "N/A";
    }

    try {
        const tmdbData = await fetchTMDBSeries(seriesTitle);
        if (!tmdbData) {
            return "N/A"; // TMDB data not found
        }

        return calculateMissing(episodesStr, tmdbData.seasons);
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

async function loadExcelFromFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    return parseWorkbookBuffer(arrayBuffer);
}

function waitForFileSelection() {
    return new Promise((resolve, reject) => {
        const input = document.getElementById('excelFileInput');
        if (!input) {
            return reject(new Error('File input not available.'));
        }

        const handler = () => {
            const file = input.files?.[0];
            if (file) {
                input.removeEventListener('change', handler);
                resolve(file);
            }
        };

        input.addEventListener('change', handler);
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

    // Try automatic fetch first (works on both HTTP and file:// in some cases)
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

    // If automatic fetch failed and we're on file://, wait for user to select file
    if (location.protocol === 'file:') {
        console.log("Automatic Excel loading failed. Waiting for manual file selection...");
        try {
            const file = await waitForFileSelection();
            const jsonData = await loadExcelFromFile(file);
            const normalized = normalizeCachedData(jsonData);
            excelCache = normalized;
            localStorage.setItem("excelCache", JSON.stringify(normalized));
            console.log("Successfully loaded Excel from user file selection");
            return normalized;
        } catch (err) {
            console.error("Failed to load Excel from file input:", err);
            return [];
        }
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
    const missing = document.getElementById("missingFilter")?.value || "";

    CONFIG.filteredData = CONFIG.data.filter((item, index) => {
        const statusMatch = status ? item.Status === status : true;
        const typeMatch = type ? item.Type === type : true;

        const searchMatch = CONFIG.search
            ? Object.values(item).join(" ").toLowerCase().includes(CONFIG.search)
            : true;

        // Filter by missing status
        let missingMatch = true;
        if (missing) {
            const rowMissingValue = missingValuesMap[index] || "Loading...";
            if (missing === "Has Missing") {
                // Match rows that have missing episodes (not "Complete", "N/A", "Unknown")
                missingMatch = rowMissingValue !== "Complete" && rowMissingValue !== "N/A" && rowMissingValue !== "Unknown" && rowMissingValue !== "Error" && rowMissingValue !== "Loading...";
            } else {
                missingMatch = rowMissingValue === missing;
            }
        }

        return statusMatch && typeMatch && searchMatch && missingMatch;
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
    renderTableHead();
    renderTable();
    renderPagination();
}

// =====================
// TABLE RENDER
// =====================
function renderTableHead() {
    const headRow = CONFIG.tableHead;
    if (!headRow) return;

    headRow.innerHTML = "";

    const statusFilter = document.getElementById("statusFilter")?.value || "";
    const columnsToRender = [...CONFIG.columns];
    if (statusFilter === "Download") {
        const typeIndex = columnsToRender.indexOf("Type");
        if (typeIndex >= 0 && !columnsToRender.includes("Download")) {
            columnsToRender.splice(typeIndex + 1, 0, "Download");
        } else if (!columnsToRender.includes("Download")) {
            columnsToRender.push("Download");
        }
    }

    // Always add Missing column after Download or at end
    if (!columnsToRender.includes("Missing")) {
        columnsToRender.push("Missing");
    }

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


function renderTable() {
    const tbody = CONFIG.tableBody;
    if (!tbody) return;

    const start = (CONFIG.currentPage - 1) * CONFIG.rowsPerPage;
    const end = start + CONFIG.rowsPerPage;

    const pageData = CONFIG.filteredData.slice(start, end);
    const statusFilter = document.getElementById("statusFilter")?.value || "";
    const columnsToRender = [...CONFIG.columns];
    if (statusFilter === "Download") {
        const typeIndex = columnsToRender.indexOf("Type");
        if (typeIndex >= 0 && !columnsToRender.includes("Download")) {
            columnsToRender.splice(typeIndex + 1, 0, "Download");
        } else if (!columnsToRender.includes("Download")) {
            columnsToRender.push("Download");
        }
    }

    // Always add Missing column
    if (!columnsToRender.includes("Missing")) {
        columnsToRender.push("Missing");
    }

    tbody.innerHTML = pageData
        .map((row, rowIndex) => `
            <tr data-row-index="${start + rowIndex}">
                ${columnsToRender
                    .map(col => {
                        if (col === "Download") {
                            return `<td>${renderSearchCell(row)}</td>`;
                        }
                        if (col === "Missing") {
                            return `<td class="missing-cell" data-series="${getSeriesTitle(row).replace(/"/g, '&quot;')}" data-episodes="${getEpisodesString(row).replace(/"/g, '&quot;')}">
                                <span class="missing-loading">Loading...</span>
                            </td>`;
                        }
                        return `<td>${row[col] || ""}</td>`;
                    })
                    .join("")}
            </tr>
        `)
        .join("");

    // Load missing episodes asynchronously for visible cells
    loadMissingEpisodesForVisibleCells();
}

// Load missing episodes for currently visible cells
async function loadMissingEpisodesForVisibleCells() {
    const missingCells = document.querySelectorAll(".missing-cell");
    console.log(`loadMissingEpisodesForVisibleCells: Processing ${missingCells.length} cells`);

    for (const cell of missingCells) {
        const seriesTitle = cell.getAttribute("data-series");
        const episodesStr = cell.getAttribute("data-episodes");
        const rowIndex = parseInt(cell.closest("tr")?.getAttribute("data-row-index"), 10);

        console.log(`Cell ${rowIndex}: seriesTitle="${seriesTitle}", episodesStr="${episodesStr}"`);

        if (!seriesTitle || !episodesStr) {
            console.log(`Cell ${rowIndex}: Missing seriesTitle or episodesStr - setting N/A`);
            cell.innerHTML = "N/A";
            if (!Number.isNaN(rowIndex)) missingValuesMap[rowIndex] = "N/A";
            continue;
        }

        try {
            const tmdbData = await fetchTMDBSeries(seriesTitle);
            if (!tmdbData) {
                console.log(`Cell ${rowIndex}: No TMDB data found - setting N/A`);
                cell.innerHTML = "N/A";
                if (!Number.isNaN(rowIndex)) missingValuesMap[rowIndex] = "N/A";
                continue;
            }

            const missingStr = calculateMissing(episodesStr, tmdbData.seasons);
            console.log(`Cell ${rowIndex}: Calculated missing="${missingStr}"`);
            cell.innerHTML = `<span class="missing-value">${missingStr}</span>`;
            if (!Number.isNaN(rowIndex)) missingValuesMap[rowIndex] = missingStr;
        } catch (err) {
            console.error(`Error loading missing for ${seriesTitle}:`, err);
            cell.innerHTML = "Error";
            if (!Number.isNaN(rowIndex)) missingValuesMap[rowIndex] = "Error";
        }
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
function clearFilters() {
    const statusEl = document.getElementById("statusFilter");
    const typeEl = document.getElementById("typeFilter");
    const siteEl = document.getElementById("siteFilter");
    const missingEl = document.getElementById("missingFilter");
    const searchEl = document.getElementById("searchInput");
    const rowsSelect = document.getElementById("rowsPerPageSelect");

    if (statusEl) statusEl.value = "";
    if (typeEl) typeEl.value = "";
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

    // reset to first page
    CONFIG.currentPage = 1;

    // keep rowsPerPage as-is (reflect in select)
    if (rowsSelect) rowsSelect.value = String(CONFIG.rowsPerPage || 10);

    // reapply filters and update UI
    applyAll();
    renderTableHead();
    renderTable();
    renderPagination();

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

    // Load TMDB cache from localStorage
    tmdbCache = JSON.parse(localStorage.getItem("tmdbCache")) || {};

    // Load Excel and get normalized data directly
    const loadedData = await loadExcelOnce();
    CONFIG.data = Array.isArray(loadedData) ? loadedData : [];

    CONFIG.columns = Object.keys(CONFIG.data[0] || {}).filter(col => col !== "Search" && col !== "Download");

    // Debug: Log data structure
    console.log("=== EXCEL DATA LOADED ===");
    console.log("Total rows:", CONFIG.data.length);
    console.log("Available columns:", CONFIG.columns);
    if (CONFIG.data.length > 0) {
        console.log("First row:", CONFIG.data[0]);
        logRowDebugInfo(CONFIG.data[0], 0);
        if (CONFIG.data.length > 1) logRowDebugInfo(CONFIG.data[1], 1);
    }

    syncFromURL();

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
            applyAll();
            renderTable();
            renderPagination();
        });
    }

    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                CONFIG.search = e.target.value.toLowerCase();
                CONFIG.currentPage = 1;

                applyAll();
                renderTable();
                renderPagination();
            }, 250);
        });
    }

    const statusFilter = document.getElementById("statusFilter");
    if (statusFilter) statusFilter.addEventListener("change", () => {
        CONFIG.currentPage = 1;
        applyAll();
        updateURL();
        renderTable();
        renderPagination();
    });

    const typeFilter = document.getElementById("typeFilter");
    if (typeFilter) typeFilter.addEventListener("change", () => {
        CONFIG.currentPage = 1;
        applyAll();
        updateURL();
        renderTable();
        renderPagination();
    });

    const siteFilter = document.getElementById("siteFilter");
    if (siteFilter) siteFilter.addEventListener("change", () => {
        CONFIG.site = siteFilter.value;
        CONFIG.currentPage = 1;
        updateURL();
        renderTable();
        renderPagination();
    });

    const missingFilter = document.getElementById("missingFilter");
    if (missingFilter) missingFilter.addEventListener("change", () => {
        CONFIG.missing = missingFilter.value;
        CONFIG.currentPage = 1;
        updateURL();
        applyAll();
        renderTable();
        renderPagination();
    });

    const clearBtn = document.getElementById("clearFiltersBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            clearFilters();
        });
    }

    // initial render
    applyAll();
    renderTableHead();
    renderTable();
    renderPagination();
}

window.CONFIG = CONFIG;
window.init = init;
window.clearFilters = clearFilters;
window.toggleSort = toggleSort;
window.changePage = changePage;
window.renderPagination = renderPagination;
window.renderTable = renderTable;
window.applyAll = applyAll;