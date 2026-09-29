window.history.scrollRestoration = "manual";

window.onload = function () {
    window.scrollTo(0, 0);
};

// --- Farmer Decision Panel Interactivity ---
document.addEventListener("DOMContentLoaded", function () {
    const suggestedCard = document.getElementById("card-suggested");
    const cropSearchCard = document.getElementById("card-crop-search");
    const resultPanel = document.getElementById("decision-result-panel");
    const panelTitle = document.getElementById("panel-title");
    const panelBody = document.getElementById("panel-body");
    const closeBtn = document.getElementById("close-panel-btn");
    const districtSelect = document.getElementById("district");

    if (!suggestedCard || !cropSearchCard || !resultPanel) {
        return; // Only execute on pages that have the decision panel
    }

    let currentMode = null; // 'suggested' or 'search'
    let districtData = {};
    let dataPromise = null;

    // Load data from Data/crops.json
    function loadCropsData() {
        if (!dataPromise) {
            const isInsidePages = window.location.pathname.includes("/Pages/");
            const jsonPath = isInsidePages ? "../Data/crops.json" : "Data/crops.json";

            dataPromise = fetch(jsonPath)
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                    return res.json();
                })
                .then(data => {
                    const rawDistricts = data?.regional_crop_agronomy_database?.districts || data?.districts || [];
                    districtData = {};
                    if (Array.isArray(rawDistricts)) {
                        rawDistricts.forEach(d => {
                            districtData[d.district_name.toLowerCase()] = d;
                        });
                    } else {
                        districtData = rawDistricts;
                    }
                })
                .catch(err => {
                    console.error("Failed to load Data/crops.json:", err);
                });
        }
        return dataPromise;
    }

    // Pre-fetch data immediately
    loadCropsData();

    function renderSuggestedCrops() {
        const districtKey = districtSelect.value;

        if (!districtKey || !districtData[districtKey]) {
            panelTitle.textContent = "Recommended Crops";
            panelBody.innerHTML = `
                <div class="district-alert">
                    <span class="alert-icon">⚠️</span>
                    <div>
                        <strong>No District Selected:</strong> Please choose your district (<strong>Sangli, Satara, or Nashik</strong>) from the dropdown above to view localized crop suggestions.
                    </div>
                </div>
            `;
            districtSelect.focus();
            return;
        }

        const data = districtData[districtKey];
        panelTitle.textContent = `Agronomically Recommended Crops for ${data.district_name}`;

        const soilsList = (data.predominant_soil_types || []).map(s => `<li>${s}</li>`).join("");

        const cropsHtml = (data.viable_recommended_crops || []).map((crop, idx) => `
            <div class="crop-card" onclick="openCropModal('${districtKey}', ${idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openCropModal('${districtKey}', ${idx});}" role="button" tabindex="0">
                <div class="crop-top">
                    <span class="crop-name">${crop.crop_name}</span>
                    <span class="match-badge">${crop.suitability_rating}</span>
                </div>
                <div class="card-hint">
                    <span>View full details</span>
                    <span>→</span>
                </div>
            </div>
        `).join("");

        panelBody.innerHTML = `
            <div class="district-summary-box">
                <div style="width: 100%; margin-bottom: 6px;">
                    <span class="district-badge">${data.district_name} Agronomy Profile</span>
                </div>
                <div class="summary-meta" style="width: 100%;">
                    <strong>Predominant Soil Types:</strong>
                    <ul style="margin: 4px 0 8px 18px; padding: 0;">${soilsList}</ul>
                </div>
                <div class="summary-meta" style="width: 100%;">
                    <strong>Soil Chemical Profile:</strong> ${data.soil_chemical_profile}
                </div>
            </div>
            <div class="crop-grid">
                ${cropsHtml}
            </div>
        `;
    }

    function renderCropSearch() {
        panelTitle.textContent = "Evaluate Crop Compatibility";

        const chips = ["Turmeric", "Table Grapes", "Sugarcane", "Strawberry", "Onion", "Tomato", "Pomegranate", "Dragon Fruit", "Soybean", "Rice"];

        panelBody.innerHTML = `
            <div class="search-container">
                <p style="margin: 0; font-size: 14px; color: #445343;">
                    Search any crop or select a quick option to evaluate scientific suitability for your district.
                </p>
                <div class="search-bar-row">
                    <input type="text" id="crop-query-input" placeholder="Enter crop name (e.g. Turmeric, Grapes, Strawberry, Onion, Cotton)...">
                    <button id="check-crop-btn" class="check-btn">Evaluate</button>
                </div>
                <div class="crop-chips">
                    <span class="chips-label">Quick crops:</span>
                    ${chips.map(c => `<button type="button" class="crop-chip" data-crop="${c.toLowerCase()}">${c}</button>`).join("")}
                </div>
                <div id="crop-eval-result"></div>
            </div>
        `;

        const input = document.getElementById("crop-query-input");
        const checkBtn = document.getElementById("check-crop-btn");
        const chipButtons = document.querySelectorAll(".crop-chip");

        function evaluateCrop(cropName) {
            const query = (cropName || input.value || "").trim().toLowerCase();
            const resultBox = document.getElementById("crop-eval-result");
            const districtKey = districtSelect.value;

            if (!query) {
                resultBox.innerHTML = `
                    <div class="district-alert" style="margin-top: 14px;">
                        <span class="alert-icon">ℹ️</span>
                        <div>Please enter a crop name to check suitability.</div>
                    </div>
                `;
                return;
            }

            if (!districtKey) {
                resultBox.innerHTML = `
                    <div class="district-alert" style="margin-top: 14px;">
                        <span class="alert-icon">⚠️</span>
                        <div>Please select a district (Sangli, Satara, or Nashik) above so we can verify soil and nutrient compatibility.</div>
                    </div>
                `;
                districtSelect.focus();
                return;
            }

            const currentDistrict = districtData[districtKey];
            const currentCrops = currentDistrict?.viable_recommended_crops || [];

            // Look for match in current district
            const matchedCrop = currentCrops.find(c =>
                c.crop_name.toLowerCase().includes(query) ||
                query.includes(c.crop_name.toLowerCase()) ||
                (c.scientific_name && c.scientific_name.toLowerCase().includes(query))
            );

            if (matchedCrop) {
                const fert = matchedCrop.fertilizer_requirements || {};
                resultBox.innerHTML = `
                    <div class="crop-result-box">
                        <h4>${matchedCrop.crop_name} (<em>${matchedCrop.scientific_name}</em>) in ${currentDistrict.district_name}</h4>
                        <span class="compat-status high">Suitability: ${matchedCrop.suitability_rating}</span>
                        <p><strong>Season:</strong> ${matchedCrop.growing_season}</p>
                        <p><strong>Target Soil:</strong> ${matchedCrop.target_soil_type}</p>
                        <div class="crop-fertilizer" style="margin-top: 8px;">
                            <p><strong>Recommended NPK:</strong> ${fert.recommended_npk_kg_per_ha}</p>
                            <p><strong>Organic Manure:</strong> ${fert.organic_manure}</p>
                            <p><strong>Secondary & Micronutrients:</strong> ${fert.secondary_and_micronutrients}</p>
                            <p><strong>Application Schedule:</strong> ${fert.application_schedule_and_rationale}</p>
                        </div>
                    </div>
                `;
            } else {
                // Check if recommended in other districts
                let otherDistrictFound = null;
                let otherCropFound = null;

                for (const dKey in districtData) {
                    if (dKey !== districtKey) {
                        const match = (districtData[dKey].viable_recommended_crops || []).find(c =>
                            c.crop_name.toLowerCase().includes(query) ||
                            query.includes(c.crop_name.toLowerCase())
                        );
                        if (match) {
                            otherDistrictFound = districtData[dKey].district_name;
                            otherCropFound = match;
                            break;
                        }
                    }
                }

                if (otherCropFound) {
                    resultBox.innerHTML = `
                        <div class="crop-result-box">
                            <h4>${otherCropFound.crop_name} in ${currentDistrict.district_name}</h4>
                            <span class="compat-status medium">Regional Note</span>
                            <p>
                                <strong>${otherCropFound.crop_name}</strong> is primarily recommended for <strong>${otherDistrictFound}</strong> 
                                (${otherCropFound.suitability_rating}) due to specific soil profile: <em>${otherCropFound.target_soil_type}</em>.
                            </p>
                            <p style="margin-top: 6px;">
                                In ${currentDistrict.district_name}, cultivation requires strict soil amendment and microclimate management to match its preferred growing conditions.
                            </p>
                        </div>
                    `;
                } else {
                    resultBox.innerHTML = `
                        <div class="crop-result-box">
                            <h4>${query.toUpperCase()} in ${currentDistrict.district_name}</h4>
                            <span class="compat-status medium">General Evaluation</span>
                            <p>
                                Not currently in the top 10 primary vetted crops for ${currentDistrict.district_name}. 
                                Ensure detailed soil pH testing (target district chemical profile: ${currentDistrict.soil_chemical_profile}) and check local water availability before planting.
                            </p>
                        </div>
                    `;
                }
            }
        }

        checkBtn.addEventListener("click", () => evaluateCrop());
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") evaluateCrop();
        });

        chipButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                input.value = btn.textContent;
                evaluateCrop(btn.dataset.crop);
            });
        });
    }

    async function openSection(mode) {
        currentMode = mode;
        resultPanel.style.display = "block";

        if (!districtData || Object.keys(districtData).length === 0) {
            panelBody.innerHTML = `<p style="padding: 12px; color: #445343; font-size: 14px;">Loading regional data...</p>`;
            await loadCropsData();
        }

        if (mode === "suggested") {
            suggestedCard.classList.add("active");
            cropSearchCard.classList.remove("active");
            renderSuggestedCrops();
        } else {
            cropSearchCard.classList.add("active");
            suggestedCard.classList.remove("active");
            renderCropSearch();
        }

        resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    suggestedCard.addEventListener("click", () => openSection("suggested"));
    cropSearchCard.addEventListener("click", () => openSection("search"));

    // Also support keyboard Enter / Space on decision cards
    [suggestedCard, cropSearchCard].forEach(card => {
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                card.click();
            }
        });
    });

    closeBtn.addEventListener("click", () => {
        resultPanel.style.display = "none";
        suggestedCard.classList.remove("active");
        cropSearchCard.classList.remove("active");
        currentMode = null;
    });

    districtSelect.addEventListener("change", () => {
        if (resultPanel.style.display !== "none" && currentMode) {
            openSection(currentMode);
        }
    });

    // --- Huge Card Modal Controls ---
    window.openCropModal = function (districtKey, cropIndex) {
        const district = districtData[districtKey];
        if (!district) return;
        const crop = (district.viable_recommended_crops || [])[cropIndex];
        if (!crop) return;

        const modal = document.getElementById("crop-modal");
        if (!modal) return;

        document.getElementById("modal-district").textContent = district.district_name;
        document.getElementById("modal-rating").textContent = `★ ${crop.suitability_rating}`;
        document.getElementById("modal-crop-name").textContent = crop.crop_name;
        document.getElementById("modal-scientific").textContent = crop.scientific_name || "";
        document.getElementById("modal-season").textContent = crop.growing_season || "N/A";
        document.getElementById("modal-soil").textContent = crop.target_soil_type || "N/A";

        const fert = crop.fertilizer_requirements || {};
        document.getElementById("modal-npk").textContent = fert.recommended_npk_kg_per_ha || "Standard dose";
        document.getElementById("modal-manure").textContent = fert.organic_manure || "Organic manure as recommended";
        document.getElementById("modal-micronutrients").textContent = fert.secondary_and_micronutrients || "Standard micronutrients";
        document.getElementById("modal-schedule").textContent = fert.application_schedule_and_rationale || "Balanced phased application.";

        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
    };

    window.closeCropModal = function () {
        const modal = document.getElementById("crop-modal");
        if (modal) {
            modal.style.display = "none";
            document.body.style.overflow = "auto";
        }
    };

    const modalCloseBtn = document.getElementById("modal-close-btn");
    const modalDoneBtn = document.getElementById("modal-done-btn");
    const cropModal = document.getElementById("crop-modal");

    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeCropModal);
    if (modalDoneBtn) modalDoneBtn.addEventListener("click", closeCropModal);
    if (cropModal) {
        cropModal.addEventListener("click", (e) => {
            if (e.target.id === "crop-modal") closeCropModal();
        });
    }

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeCropModal();
    });
});

