document.addEventListener("DOMContentLoaded", function () {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    if (!id) {
        document.getElementById("seriesTitle").textContent = "Error";
        document.getElementById("seriesSummary").innerHTML = "<p class='text-center'>No item ID provided.</p>";
        return;
    }

    const cachedData = JSON.parse(localStorage.getItem("excelCache") || "[]");
    const item = cachedData[id];

    if (!item) {
        document.getElementById("seriesTitle").textContent = "Not Found";
        document.getElementById("seriesSummary").innerHTML = "<p class='text-center'>Item not found in database.</p>";
        return;
    }

    const seriesTitle = item["Serial Name"] || item["title"] || item["Name"] || "";
    document.getElementById("seriesTitle").textContent = seriesTitle || "Unknown Series";

    const tvmazeCache = JSON.parse(localStorage.getItem("tvmazeCache") || "{}");
    const apiResponse = tvmazeCache[seriesTitle];

    const safe = (val, fallback = "N/A") => (val !== null && val !== undefined && val !== "" ? val : fallback);
    const safeArr = (arr, fallback = "N/A") => (Array.isArray(arr) && arr.length > 0 ? arr.join(", ") : fallback);

    const createInfoRow = (label, value) => {
        return `
            <div class="col-6 col-sm-4">
                <span class="info-label d-block">${label}</span>
                <span class="info-value">${value}</span>
            </div>
        `;
    };

    if (apiResponse && apiResponse.data && apiResponse.data.length > 0) {
        const apiData = apiResponse.data[0].show;

        // 1. Hero Section
        const posterUrl = apiData.image?.medium || apiData.image?.original || "";
        document.getElementById("seriesPoster").src = posterUrl || "Image/logo.png";
        if (!posterUrl) document.getElementById("seriesPoster").alt = "No Image Available";

        const heroBadges = document.getElementById("heroBadges");
        heroBadges.innerHTML = `
            <span class="badge bg-primary">${safe(apiData.type)}</span>
            <span class="badge bg-secondary">${safe(apiData.language)}</span>
            <span class="badge bg-info text-dark">${safe(apiData.status)}</span>
        `;

        document.getElementById("seriesRating").textContent = safe(apiData.rating?.average, "N/A");
        document.getElementById("seriesPremiered").textContent = safe(apiData.premiered);
        document.getElementById("seriesRuntime").textContent = apiData.runtime ? `${apiData.runtime} min` : "N/A";

        // 2. Summary
        document.getElementById("seriesSummary").innerHTML = apiData.summary || "No summary available.";

        // 3. General Information
        const generalInfoDiv = document.getElementById("generalInfo");
        let generalHtml = "";
        generalHtml += createInfoRow("Genres", safeArr(apiData.genres));
        generalHtml += createInfoRow("Ended", safe(apiData.ended));
        generalHtml += createInfoRow("Avg Runtime", apiData.averageRuntime ? `${apiData.averageRuntime} min` : "N/A");
        generalHtml += createInfoRow("Network", safe(apiData.network?.name || apiData.webChannel?.name));
        generalHtml += createInfoRow("Schedule", apiData.schedule ? `${safeArr(apiData.schedule.days)} at ${safe(apiData.schedule.time)}` : "N/A");
        generalInfoDiv.innerHTML = generalHtml;

        // 4. Technical Details
        const technicalInfoDiv = document.getElementById("technicalInfo");
        let techHtml = "";
        techHtml += createInfoRow("Show ID", safe(apiData.id));
        techHtml += createInfoRow("Weight", safe(apiData.weight));
        techHtml += createInfoRow("DVD Country", safe(apiData.dvdCountry));
        techHtml += createInfoRow("Updated", safe(apiData.updated));
        techHtml += createInfoRow("IMDb ID", safe(apiData.externals?.imdb));
        techHtml += createInfoRow("TVMaze ID", safe(apiData.externals?.tvrage));
        techHtml += createInfoRow("TVDB ID", safe(apiData.externals?.thetvdb));
        techHtml += createInfoRow("Country", safe(apiData.network?.country?.name || apiData.webChannel?.country?.name));
        techHtml += createInfoRow("Country Code", safe(apiData.network?.country?.code || apiData.webChannel?.country?.code));
        techHtml += createInfoRow("Timezone", safe(apiData.network?.country?.timezone || apiData.webChannel?.country?.timezone));
        technicalInfoDiv.innerHTML = techHtml;

        // 5. External Links
        const linksDiv = document.getElementById("externalLinks");
        linksDiv.innerHTML = "";
        if (apiData.officialSite) {
            linksDiv.innerHTML += `<a href="${apiData.officialSite}" target="_blank" class="btn btn-outline-primary text-start"><i class="bi bi-globe me-2"></i> Official Website</a>`;
        }
        if (apiData._links?.self?.href) {
            linksDiv.innerHTML += `<a href="${apiData._links.self.href}" target="_blank" class="btn btn-outline-secondary text-start"><i class="bi bi-link-45deg me-2"></i> TVMaze API</a>`;
        }
        if (apiData._links?.previousepisode?.href) {
            linksDiv.innerHTML += `<a href="${apiData._links.previousepisode.href}" target="_blank" class="btn btn-outline-info text-start"><i class="bi bi-arrow-left-circle me-2"></i> Previous Episode</a>`;
        }
    } else {
        document.getElementById("seriesSummary").innerHTML = "No additional API data available for this series.";
    }

    // 6. Database Info (Local Excel Data)
    const dbInfoDiv = document.getElementById("databaseInfo");
    let dbHtml = "";
    Object.entries(item).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") return;
        dbHtml += `
            <div class="col-sm-6">
                <div class="p-2 border-bottom">
                    <strong class="info-label d-block small">${key}</strong>
                    <span class="info-value">${value}</span>
                </div>
            </div>
        `;
    });
    dbInfoDiv.innerHTML = dbHtml || "No database information available.";
});