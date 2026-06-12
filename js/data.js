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

    tableBody: null,
    tableHead: null,
    pagination: null,
};

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
        return obj;
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

    // If opened via file://, wait for user to select file
    if (location.protocol === 'file:') {
        try {
            const file = await waitForFileSelection();
            const jsonData = await loadExcelFromFile(file);
            const normalized = normalizeCachedData(jsonData);
            excelCache = normalized;
            localStorage.setItem("excelCache", JSON.stringify(normalized));
            return normalized;
        } catch (err) {
            console.error("Failed to load Excel from file input:", err);
            return [];
        }
    }

    // Otherwise, try automatic fetch (for Go Live / HTTP)
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
            return normalized;
        } catch (err) {
            console.warn(`Unable to load Excel from ${path}:`, err);
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
        return normalized;
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

    const statusEl = document.getElementById("statusFilter");
    const typeEl = document.getElementById("typeFilter");
    if (statusEl) statusEl.value = params.get("status") || "";
    if (typeEl) typeEl.value = params.get("type") || "";
}

function updateURL() {
    const params = new URLSearchParams();

    params.set("page", CONFIG.currentPage);

    const status = document.getElementById("statusFilter")?.value;
    const type = document.getElementById("typeFilter")?.value;
    const rpp = CONFIG.rowsPerPage;

    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (rpp) params.set("rpp", String(rpp));

    window.history.replaceState({}, "", `?${params.toString()}`);
}

// =====================
// CORE FILTER ENGINE
// =====================
function applyAll() {
    const status = document.getElementById("statusFilter")?.value || "";
    const type = document.getElementById("typeFilter")?.value || "";

    CONFIG.filteredData = CONFIG.data.filter(item => {
        const statusMatch = status ? item.Status === status : true;
        const typeMatch = type ? item.Type === type : true;

        const searchMatch = CONFIG.search
            ? Object.values(item).join(" ").toLowerCase().includes(CONFIG.search)
            : true;

        return statusMatch && typeMatch && searchMatch;
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

    CONFIG.columns.forEach(col => {
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

    tbody.innerHTML = pageData
        .map(row => `
            <tr>
                ${CONFIG.columns.map(col => `<td>${row[col] || ""}</td>`).join("")}
            </tr>
        `)
        .join("");
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
    const searchEl = document.getElementById("searchInput");
    const rowsSelect = document.getElementById("rowsPerPageSelect");

    if (statusEl) statusEl.value = "";
    if (typeEl) typeEl.value = "";
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

    // Load Excel and get normalized data directly
    const loadedData = await loadExcelOnce();
    CONFIG.data = Array.isArray(loadedData) ? loadedData : [];
    CONFIG.columns = Object.keys(CONFIG.data[0] || {});

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