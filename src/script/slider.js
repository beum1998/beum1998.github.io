const DEFAULT_BUTTON_LABELS = {
    open: "Show",
    close: "Hide",
};

export function sliderControls(sliderName, timeKeys, timeJson, allGroup, meshDict, isPartial) {
    const slider = document.getElementById(sliderName);
    if (!slider || !timeKeys?.length) return;

    slider.max = timeKeys.length - 1;
    slider.value = timeKeys.length - 1;
    const currentTime = timeKeys[timeKeys.length - 1];

    const buttonState = {
        "Walls": false,
        "Curtain Walls": false,
        "Floors": false,
        "Ceilings": false,
        "Columns": false,
        "Structural Columns": false,
        "Stairs": false,
        "Railings": false,
        "Windows": false,
        "Doors": false,
    };

    updateMeshes(currentTime);
    if (!isPartial) {
        updateInfos(currentTime);
    }

    const tooltip = attachSliderTooltip(slider);
    let hideTimer = null;

    slider.addEventListener("input", () => {
        const currentIndex = parseInt(slider.value, 10);
        const nextTime = timeKeys[currentIndex];
        updateMeshes(nextTime);
        if (!isPartial) {
            updateInfos(nextTime);
        } else {
            const insideButton = document.getElementById("inside-button");
            if (insideButton && !insideButton.classList.contains("Visible")) {
                insideButton.classList.add("Visible");
                insideButton.style.backgroundColor = "#4CAF50";
            }
        }
        updateSliderBackground(slider);
        if (tooltip) {
            showTooltip(tooltip, slider, formatTimeLabel(nextTime));
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => hideTooltip(tooltip), 700);
        }
    });

    const sliderFully = document.getElementById("fully-slider");
    const sliderPartially = document.getElementById("partially-slider");
    if (sliderFully) {
        sliderFully.addEventListener("input", () => updateSliderBackground(sliderFully));
        updateSliderBackground(sliderFully);
    }
    if (sliderPartially) {
        sliderPartially.addEventListener("input", () => updateSliderBackground(sliderPartially));
        updateSliderBackground(sliderPartially);
    }

    function updateMeshes(currentTimeKey) {
        for (const group of allGroup) {
            group.visible = false;
        }
        const elements = timeJson[currentTimeKey]?.Elements || [];
        for (const elementId of elements) {
            const group = meshDict[elementId];
            if (group) group.visible = true;
        }
    }

    function updateInfos(currentTimeKey) {
        const quantity = timeJson[currentTimeKey]?.Quantity || {};
        const infoTarget = document.getElementById("info-target");
        if (!infoTarget) return;

        infoTarget.innerHTML = "";
        const fragment = document.createDocumentFragment();

        for (const cat of Object.keys(quantity)) {
            const catReplace = cat.replace(/\s+/g, "-");
            const quantityCat = Object.keys(quantity[cat] || {});

            const categoryDiv = document.createElement("div");
            categoryDiv.classList.add("category-container");

            const catNameDiv = document.createElement("div");
            catNameDiv.classList.add("category-name-container");

            const title = document.createElement("div");
            title.classList.add("category-title");
            title.id = "category-title";
            title.textContent = cat;

            const button = document.createElement("button");
            button.id = `${catReplace}-category-button`;
            button.className = "category-button";
            button.type = "button";
            button.textContent = buttonState[cat] ? DEFAULT_BUTTON_LABELS.close : DEFAULT_BUTTON_LABELS.open;

            catNameDiv.appendChild(title);
            catNameDiv.appendChild(button);
            categoryDiv.appendChild(catNameDiv);

            const list = document.createElement("ul");
            list.classList.add("category-list");
            list.id = `${catReplace}-list`;

            const importantInfo = document.createElement("div");
            for (const quantityCatQuan of quantityCat) {
                const value = quantity[cat][quantityCatQuan];
                const isMain =
                    quantityCatQuan === "All Volume" ||
                    quantityCatQuan === "All Length" ||
                    quantityCatQuan === "Column Volume" ||
                    quantityCatQuan === "Column Length" ||
                    quantityCatQuan === "Stair Length" ||
                    quantityCatQuan === "Railing Length";

                if (isMain) {
                    importantInfo.innerHTML += `<div><span class="main-qunt">${quantityCatQuan}: </span> <span class="main-value">${value.toFixed(3)}</span></div>`;
                    continue;
                }

                if (quantityCatQuan === "All Numbers") {
                    importantInfo.innerHTML += `<div><span class="main-qunt">${quantityCatQuan}: </span> <span class="main-value">${value}</span></div>`;
                    continue;
                }

                const listItem = document.createElement("li");
                const isCount = ["Windows", "Doors"].includes(cat);
                const displayValue = isCount ? value : value.toFixed(3);
                listItem.innerHTML = `<span class="key123">${quantityCatQuan}: </span> <span class="value123">${displayValue}</span>`;
                list.appendChild(listItem);
            }

            categoryDiv.appendChild(importantInfo);
            categoryDiv.appendChild(list);

            if (!buttonState[cat]) {
                list.classList.add("hide");
            } else {
                list.style.maxHeight = list.scrollHeight + "px";
            }

            button.addEventListener("click", () => {
                const nextState = !buttonState[cat];
                buttonState[cat] = nextState;
                if (nextState) {
                    list.classList.remove("hide");
                    button.textContent = DEFAULT_BUTTON_LABELS.close;
                } else {
                    list.classList.add("hide");
                    button.textContent = DEFAULT_BUTTON_LABELS.open;
                }
            });

            fragment.appendChild(categoryDiv);
        }

        infoTarget.appendChild(fragment);
    }
}

function updateSliderBackground(slider) {
    const min = Number(slider.min || 0);
    const max = Number(slider.max || 100);
    const val = ((slider.value - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, #263238 0%, #45a049 ${val}%, #ddd ${val}%, #ddd 100%)`;
}

function attachSliderTooltip(slider) {
    const wrapper = slider.parentElement;
    if (!wrapper) return null;
    const tooltip = document.createElement("div");
    tooltip.className = "slider-tooltip";
    wrapper.style.position = "relative";
    wrapper.appendChild(tooltip);
    return tooltip;
}

function showTooltip(tooltip, slider, text) {
    tooltip.textContent = text;
    const min = Number(slider.min || 0);
    const max = Number(slider.max || 100);
    const val = (slider.value - min) / (max - min);
    const rect = slider.getBoundingClientRect();
    const thumbSize = 32;
    const trackWidth = rect.width - thumbSize;
    const left = val * trackWidth + thumbSize / 2;
    tooltip.style.left = `${left}px`;
    tooltip.style.transform = "translate(-50%, 0)";
    tooltip.classList.add("is-visible");
}

function hideTooltip(tooltip) {
    tooltip.classList.remove("is-visible");
}

function formatTimeLabel(value) {
    if (!value) return "";
    const match = String(value).match(/^(\d{4})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})$/);
    if (!match) return String(value);
    const [, y, m, d, hh, mm, ss] = match;
    return `${y}.${m}.${d}\n${hh}:${mm}:${ss}`;
}