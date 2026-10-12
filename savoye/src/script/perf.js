// Lightweight performance instrumentation for the web viewer.
// Logs to the console and to a small on-screen overlay so timing numbers
// (rendering time, slider update latency) can be read off directly.

let overlay = null;
const lines = {};

function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "perf-overlay";
    Object.assign(overlay.style, {
        position: "fixed",
        left: "8px",
        bottom: "8px",
        zIndex: "99999",
        background: "rgba(0,0,0,0.78)",
        color: "#27e07a",
        font: "12px/1.45 monospace",
        padding: "6px 9px",
        borderRadius: "5px",
        whiteSpace: "pre",
        pointerEvents: "none",
    });
    if (document.body) document.body.appendChild(overlay);
    return overlay;
}

// Record a labeled timing (ms). Same label updates in place.
export function perfLog(label, ms) {
    const txt = `${label}: ${ms.toFixed(1)} ms`;
    console.log("[perf] " + txt);
    lines[label] = txt;
    const o = ensureOverlay();
    o.textContent = Object.values(lines).join("\n");
}

// Record a non-timing note (e.g., element count).
export function perfNote(label, value) {
    const txt = `${label}: ${value}`;
    console.log("[perf] " + txt);
    lines[label] = txt;
    const o = ensureOverlay();
    o.textContent = Object.values(lines).join("\n");
}
