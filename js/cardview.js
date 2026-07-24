// =====================
// CARD VIEW (tvtime-style)
// Reuses the exact same data as the table (CONFIG.filteredData / CONFIG.data,
// tvmazeCache, missingValuesMap from data.js) so both views always agree.
// Card markup/CSS is intentionally left identical to tvtime.html.
// =====================

const PALETTE = [
    ["#ff5470", "#ff8a5b"], ["#5fb0ff", "#7d5fff"], ["#33d69f", "#1fa8ff"],
    ["#a78bfa", "#ff5470"], ["#ffb84d", "#ff5470"], ["#37c9c1", "#5fb0ff"],
    ["#ff8a5b", "#a78bfa"], ["#5fd6a3", "#5fb0ff"]
];

function colorFor(title) {
    let h = 0;
    for (let i = 0; i < title.length; i++) h = title.charCodeAt(i) + ((h << 5) - h);
    return PALETTE[Math.abs(h) % PALETTE.length];
}

function initials(title) {
    const words = (title || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

function getCardGrid() {
    return document.getElementById("cardGrid");
}

// Sum of local episode counts across all seasons found in the row's
// Season01/Season02... columns (mirrors the parsing already used for
// the "Missing" column in data.js).
function localTotalEpisodes(row) {
    const map = parseEpisodes(getEpisodesString(row));
    let total = 0;
    Object.values(map).forEach(s => { total += Math.max(0, s.end - s.start + 1); });
    return total;
}

// Sum of TVMaze's per-season episode counts (data.js stores the max
// episode number seen per season in tvmazeCache[title].data.seasons).
function tvmazeTotalEpisodes(seasons) {
    if (!seasons) return 0;
    return Object.values(seasons).reduce((sum, n) => sum + n, 0);
}

// TVMaze "status" (Running / Ended / In Development / To Be Determined) →
// one of the pill colors already defined in tvtime-card.css.
const TV_STATUS_BADGE_CLASS = {
    "Running": "st-continuing",
    "Ended": "st-up_to_date",
    "In Development": "st-not_started_yet",
    "To Be Determined": "st-watch_later",
};

function buildCard(row, absoluteIndex) {
    const title = getSeriesTitle(row) || "Unknown Series";
    const cachedEntry = tvmazeCache[title];
    const apiData = cachedEntry?.data?.show || null;
    const seasonsData = cachedEntry?.data?.seasons || null;

    const posterUrl = apiData?.image?.medium || apiData?.image?.original || "";
    const hasImage = !!posterUrl;

    const tvStatus = apiData?.status || "";
    const statusCls = TV_STATUS_BADGE_CLASS[tvStatus] || "text-bg-info";
    const statusLabel = tvStatus || "N/A";

    const localTotal = localTotalEpisodes(row);
    const tvTotal = tvmazeTotalEpisodes(seasonsData);
    const pct = tvTotal ? Math.min(100, Math.round((localTotal / tvTotal) * 100)) : (localTotal ? 100 : 0);

    const [c1, c2] = colorFor(title);
    const network = apiData?.network?.name || apiData?.webChannel?.name || "";
    const rating = apiData?.rating?.average;
    const localType = getRowValue(row, ["Type", "type"]) || "";

    const col = document.createElement("div");
    col.className = "col-6 col-sm-4 col-md-3 col-lg-2";
    col.innerHTML = `
        <div class="show-card" data-idx="${absoluteIndex}">
            <a href="details.html?id=${absoluteIndex}" class="poster-fake ${hasImage ? "has-image" : ""}" style="background:linear-gradient(150deg, ${c1}, ${c2});">
                ${hasImage ? `<img src="${posterUrl}" alt="" loading="lazy" class="poster-img">` : ""}
                ${localType ? `<div class="type-badge">${localType}</div>` : ""}
                <div class="status-badge ${statusCls}">${statusLabel}</div>
                ${rating ? `<div class="rating-badge"><i class="bi bi-star-fill"></i>${rating}</div>` : ""}
                <span class="poster-initial" style="position:relative;z-index:1;">${initials(title)}</span>
            </a>
            <div class="show-body">
                <div class="show-title">${title}</div>
                ${network ? `<div class="show-network">${network}${apiData.premiered ? " &middot; " + apiData.premiered.slice(0, 4) : ""}</div>` : ""}
                <div class="ep-count">${localTotal} / ${tvTotal || "?"} episodes</div>
                <div class="progress"><div class="progress-bar" role="progressbar" style="width:${pct}%"></div></div>
                <button class="expand-btn" data-toggle="${absoluteIndex}">
                    <i class="bi bi-chevron-down"></i> Show Seasons
                </button>
            </div>
            <div class="detail-panel" id="cardPanel-${absoluteIndex}"></div>
        </div>
    `;
    return col;
}

function fillCardAboutBlock(el, cachedEntry) {
    const apiData = cachedEntry?.data?.show;

    if (!cachedEntry) {
        el.innerHTML = `<div class="about-loading"><span class="spin"></span> Fetching info from TVMaze&hellip;</div>`;
        return;
    }
    if (!apiData) {
        el.innerHTML = `<div class="about-loading" style="color:var(--txt-2);"><i class="bi bi-slash-circle"></i> Not found on TVMaze.</div>`;
        return;
    }

    const genres = (apiData.genres || []).map(g => `<span class="genre-badge">${g}</span>`).join("");
    const metaBits = [];
    const network = apiData.network?.name || apiData.webChannel?.name;
    if (network) metaBits.push(`<span><i class="bi bi-broadcast"></i> ${network}</span>`);
    if (apiData.premiered) metaBits.push(`<span><i class="bi bi-calendar3"></i> ${apiData.premiered}</span>`);
    if (apiData.averageRuntime || apiData.runtime) metaBits.push(`<span><i class="bi bi-clock"></i> ${apiData.averageRuntime || apiData.runtime} min</span>`);
    if (apiData.rating?.average) metaBits.push(`<span><i class="bi bi-star-fill" style="color:#ffd15c;"></i> ${apiData.rating.average}</span>`);
    if (apiData.status) metaBits.push(`<span><i class="bi bi-broadcast-pin"></i> ${apiData.status}</span>`);

    el.innerHTML = `
        ${genres ? `<div>${genres}</div>` : ""}
        <div class="about-meta">${metaBits.join("")}</div>
        ${apiData.summary ? `<div class="about-summary">${apiData.summary}</div>` : ""}
    `;
}

// Per-season summary (local range vs. TVMaze total). No per-episode
// watched/unwatched list — that data doesn't exist in the Excel sheet.
function buildCardSeasonPanel(row, absoluteIndex) {
    const panel = document.getElementById(`cardPanel-${absoluteIndex}`);
    if (!panel || panel.dataset.built) return;
    panel.dataset.built = "1";

    const title = getSeriesTitle(row);
    const cachedEntry = tvmazeCache[title];
    const seasonsData = cachedEntry?.data?.seasons || {};
    const localMap = parseEpisodes(getEpisodesString(row));

    const about = document.createElement("div");
    about.className = "about-block";
    panel.appendChild(about);
    fillCardAboutBlock(about, cachedEntry);

    const seasonNums = Object.keys(seasonsData).map(Number).sort((a, b) => a - b);
    if (seasonNums.length === 0) {
        if (cachedEntry) {
            const msg = document.createElement("div");
            msg.className = "about-loading";
            msg.style.color = "var(--txt-2)";
            msg.textContent = "No season data available.";
            panel.appendChild(msg);
        }
        return;
    }

    seasonNums.forEach(n => {
        const total = seasonsData[n];
        const have = localMap[n] ? localMap[n].end : 0;
        const pct = total ? Math.min(100, Math.round((have / total) * 100)) : 0;
        const wrap = document.createElement("div");
        wrap.innerHTML = `
            <div class="season-head">
                <span>Season ${n}</span>
                <span class="d-flex align-items-center gap-2">
                    <span class="ep-count">${have}/${total}</span>
                    <span class="season-progress-mini progress"><span class="progress-bar" style="display:block;width:${pct}%;height:100%;border-radius:99px;background:var(--ok);"></span></span>
                </span>
            </div>
        `;
        panel.appendChild(wrap);
    });
}

function initCardGridEvents() {
    const grid = getCardGrid();
    if (!grid || grid.dataset.wired) return;
    grid.dataset.wired = "1";

    grid.addEventListener("click", (e) => {
        const toggleBtn = e.target.closest("[data-toggle]");
        if (!toggleBtn) return;
        e.preventDefault();

        const idx = toggleBtn.dataset.toggle;
        const panel = document.getElementById(`cardPanel-${idx}`);
        const row = CONFIG.data[idx];
        if (!panel || !row) return;

        buildCardSeasonPanel(row, idx);
        panel.classList.toggle("open");
        const isOpen = panel.classList.contains("open");
        toggleBtn.innerHTML = isOpen
            ? '<i class="bi bi-chevron-up"></i> Hide Seasons'
            : '<i class="bi bi-chevron-down"></i> Show Seasons';
    });
}

// Renders the same page slice the table shows (CONFIG.filteredData,
// paginated by CONFIG.currentPage/rowsPerPage), so filters/search/sort/
// pagination stay identical between the two views.
function renderCards() {
    const grid = getCardGrid();
    if (!grid) return;

    const start = (CONFIG.currentPage - 1) * CONFIG.rowsPerPage;
    const end = start + CONFIG.rowsPerPage;
    const pageData = CONFIG.filteredData.slice(start, end);

    grid.innerHTML = "";

    if (pageData.length === 0) {
        grid.innerHTML = `<div class="empty-state"><i class="bi bi-search"></i>Nothing matches this filter.</div>`;
        return;
    }

    pageData.forEach(row => {
        const absoluteIndex = CONFIG.data.indexOf(row);
        grid.appendChild(buildCard(row, absoluteIndex));
    });

    initCardGridEvents();
}

// =====================
// VIEW TOGGLE (Table / Card)
// =====================
let cardViewActive = false;

function setView(mode) {
    cardViewActive = mode === "card";

    const tableWrap = document.querySelector(".table-responsive");
    const grid = getCardGrid();
    const tableBtn = document.getElementById("viewTableBtn");
    const cardBtn = document.getElementById("viewCardBtn");

    if (cardViewActive) {
        tableWrap?.classList.add("d-none");
        grid?.classList.remove("d-none");
        tableBtn?.classList.remove("active");
        cardBtn?.classList.add("active");
        renderCards();
    } else {
        tableWrap?.classList.remove("d-none");
        grid?.classList.add("d-none");
        cardBtn?.classList.remove("active");
        tableBtn?.classList.add("active");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("viewTableBtn")?.addEventListener("click", () => setView("table"));
    document.getElementById("viewCardBtn")?.addEventListener("click", () => setView("card"));

    // Keep the card grid in sync with the table: whenever data.js re-renders
    // the table (filter/search/sort/page change), also re-render the cards
    // if that's the active view. data.js is untouched — we just wrap the
    // global renderTable it already exposes.
    const originalRenderTable = window.renderTable;
    if (typeof originalRenderTable === "function") {
        window.renderTable = function (...args) {
            originalRenderTable.apply(this, args);
            if (cardViewActive) renderCards();
        };
    }
});