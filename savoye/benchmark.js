// ──────────────────────────────────────────────────────────────────────────
//  Scalability benchmark dashboard (paper-ready)
//  Measures, per loaded dataset: object count, vertices, payload (MB),
//  load latency broken into Fetch / Parse / Build, steady-state FPS / frame
//  time, and JS heap. Accumulates runs across datasets (×1/×4/×9/×16) so the
//  "object count vs latency" scaling curve is drawn automatically, and exports
//  the table as CSV and the chart as PNG.
// ──────────────────────────────────────────────────────────────────────────
import {
    Chart, LineController, LineElement, PointElement,
    LinearScale, Legend, Tooltip, Title
} from "chart.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend, Tooltip, Title);

const KEY = "fvBenchRuns";
const loadRuns = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } };
const saveRuns = (r) => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {} };

export const Bench = {
    _chart: null,

    // ── timed loaders (return data + payload bytes + fetch/parse split) ──
    async timedFetchJson(path) {
        const t0 = performance.now();
        const r = await fetch(path, { cache: "no-store" });
        const text = await r.text();
        const t1 = performance.now();
        const json = JSON.parse(text.replace(/^﻿/, ""));
        const t2 = performance.now();
        return { json, bytes: text.length, fetchMs: t1 - t0, parseMs: t2 - t1 };
    },
    timedReadJson(file) {
        return new Promise((resolve, reject) => {
            const t0 = performance.now();
            const reader = new FileReader();
            reader.onload = (ev) => {
                const t1 = performance.now();
                try {
                    const json = JSON.parse(String(ev.target.result).replace(/^﻿/, ""));
                    const t2 = performance.now();
                    resolve({ json, bytes: file.size, fetchMs: t1 - t0, parseMs: t2 - t1 });
                } catch (e) { reject(e); }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    },

    // ── geometry stats from a ShapeLog array ──
    countGeometry(shapeLog) {
        let objects = Array.isArray(shapeLog) ? shapeLog.length : 0, vertices = 0, triangles = 0;
        if (Array.isArray(shapeLog)) for (const e of shapeLog) {
            const ms = e && e.Meshes;
            if (!Array.isArray(ms)) continue;
            for (const mesh of ms) {
                if (Array.isArray(mesh.Vertices)) vertices += mesh.Vertices.length;
                if (Array.isArray(mesh.Faces)) triangles += Math.floor(mesh.Faces.length / 3);
                else if (Array.isArray(mesh.Indices)) triangles += Math.floor(mesh.Indices.length / 3);
            }
        }
        return { objects, vertices, triangles };
    },

    // ── steady-state render latency: sample rAF for `durationMs` ──
    measureFps(durationMs = 3000) {
        return new Promise((resolve) => {
            let frames = 0, worst = 0;
            const start = performance.now();
            let last = start;
            const tick = () => {
                const now = performance.now();
                const dt = now - last; last = now;
                if (frames > 0 && dt > worst) worst = dt;
                frames++;
                if (now - start >= durationMs) {
                    const elapsed = now - start;
                    resolve({
                        fps: Math.round((frames / (elapsed / 1000)) * 10) / 10,
                        frameMs: Math.round((elapsed / frames) * 100) / 100,
                        worstFrameMs: Math.round(worst * 100) / 100,
                    });
                } else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    },

    heapMB() {
        const m = performance.memory;
        return m ? Math.round(m.usedJSHeapSize / 1048576 * 10) / 10 : null;
    },

    // ── record one dataset run (upsert by label = keep latest) ──
    record(run) {
        const runs = loadRuns().filter(r => r.label !== run.label);
        runs.push(run);
        runs.sort((a, b) => a.objects - b.objects);
        saveRuns(runs);
        this.render();
        return run;
    },
    clear() { saveRuns([]); this.render(); },

    // High-level: time a full load given the collected pieces, then measure + record.
    async finalize({ label, shapeLog, bytes, fetchMs, parseMs, buildMs }) {
        const g = this.countGeometry(shapeLog);
        const fps = await this.measureFps(3000);
        return this.record({
            label,
            objects: g.objects,
            vertices: g.vertices,
            triangles: g.triangles,
            mb: Math.round(bytes / 1048576 * 100) / 100,
            fetchMs: Math.round(fetchMs),
            parseMs: Math.round(parseMs),
            buildMs: Math.round(buildMs),
            totalMs: Math.round(fetchMs + parseMs + buildMs),
            fps: fps.fps,
            frameMs: fps.frameMs,
            worstFrameMs: fps.worstFrameMs,
            heapMB: this.heapMB(),
        });
    },

    // ── dashboard UI ──
    ensurePanel() {
        if (document.getElementById("bench-panel")) return;
        const toggle = document.createElement("button");
        toggle.id = "bench-toggle";
        toggle.textContent = "📊 Benchmark";
        toggle.style.cssText = "display:none";   // hidden — opened via Shift+click on the Window button
        const panel = document.createElement("div");
        panel.id = "bench-panel";
        panel.style.cssText = "position:fixed;top:44px;left:8px;z-index:10000;width:560px;max-height:86vh;overflow:auto;background:#ffffff;color:#111;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:12px;font:12px/1.4 sans-serif;display:none";
        panel.innerHTML = `
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
            <strong style="font-size:13px">Web Viewer Scalability</strong>
            <span id="bench-status" style="color:#64748b;font-size:11px;margin-left:auto"></span>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            <button id="bench-csv"  style="font:11px sans-serif;padding:4px 8px;cursor:pointer">Export CSV</button>
            <button id="bench-png"  style="font:11px sans-serif;padding:4px 8px;cursor:pointer">Export Chart PNG</button>
            <button id="bench-remeasure" style="font:11px sans-serif;padding:4px 8px;cursor:pointer">Re-measure FPS</button>
            <button id="bench-clear" style="font:11px sans-serif;padding:4px 8px;cursor:pointer;color:#b91c1c">Clear</button>
          </div>
          <canvas id="bench-chart" height="200"></canvas>
          <div id="bench-table" style="margin-top:10px"></div>
          <hr style="margin:12px 0;border:none;border-top:1px solid #e2e8f0">
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
            <strong style="font-size:12px">Time-point sweep (active objects / update latency / frame rate)</strong>
            <span id="bench-sweep-status" style="color:#64748b;font-size:11px;margin-left:auto"></span>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            <button id="bench-sweep" style="font:11px sans-serif;padding:4px 8px;cursor:pointer">Run sweep</button>
            <button id="bench-sweep-csv" style="font:11px sans-serif;padding:4px 8px;cursor:pointer">Export sweep CSV</button>
          </div>
          <div id="bench-sweep-table"></div>
        `;
        document.body.appendChild(toggle);
        document.body.appendChild(panel);
        toggle.addEventListener("click", () => {
            panel.style.display = panel.style.display === "none" ? "block" : "none";
            if (panel.style.display === "block") this.render();
        });
        panel.querySelector("#bench-csv").addEventListener("click", () => this.exportCsv());
        panel.querySelector("#bench-png").addEventListener("click", () => this.exportPng());
        panel.querySelector("#bench-clear").addEventListener("click", () => { if (confirm("Clear all benchmark runs?")) this.clear(); });
        panel.querySelector("#bench-remeasure").addEventListener("click", async () => {
            const runs = loadRuns(); if (!runs.length) return;
            const last = runs[runs.length - 1];
            this.setStatus("re-measuring FPS…");
            const fps = await this.measureFps(3000);
            last.fps = fps.fps; last.frameMs = fps.frameMs; last.worstFrameMs = fps.worstFrameMs; last.heapMB = this.heapMB();
            saveRuns(runs); this.render(); this.setStatus("");
        });
        panel.querySelector("#bench-sweep").addEventListener("click", () => this.sweepTimePoints());
        panel.querySelector("#bench-sweep-csv").addEventListener("click", () => this.exportSweepCsv());
    },
    setStatus(t) { this.ensurePanel(); const s = document.getElementById("bench-status"); if (s) s.textContent = t || ""; },
    setSweepStatus(t) { const s = document.getElementById("bench-sweep-status"); if (s) s.textContent = t || ""; },
    nextFrame() { return new Promise(r => requestAnimationFrame(() => r())); },

    // ── time-point sweep: at sampled slider positions, record active objects, update latency, frame rate ──
    _median(a) { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
    async sweepTimePoints(samples = 20) {
        this.ensurePanel();
        const b = window.__fvBench;
        if (!b || !b.slider) { this.setSweepStatus("viewer not loaded — load a model first"); return; }
        const slider = b.slider;
        const max = parseInt(slider.max) || ((b.timeKeys ? b.timeKeys.length : 1) - 1);
        const n = Math.max(2, Math.min(samples, max + 1));
        // warm-up pass: remove cold JIT/GC penalty so steady-state numbers are clean
        this.setSweepStatus("warming up …");
        slider.value = Math.round(max / 2); slider.dispatchEvent(new Event("input"));
        await this.nextFrame(); await this.measureFps(300);
        const rows = [];
        for (let s = 0; s < n; s++) {
            const i = Math.round(s * max / (n - 1));
            this.setSweepStatus(`sweeping ${s + 1}/${n} …`);
            slider.value = i; slider.dispatchEvent(new Event("input")); await this.nextFrame();   // settle
            const ts = [];                                                                         // median of 3 update latencies (drop spikes)
            for (let r = 0; r < 3; r++) { const t0 = performance.now(); slider.dispatchEvent(new Event("input")); await this.nextFrame(); ts.push(performance.now() - t0); }
            const updateMs = Math.round(this._median(ts) * 100) / 100;
            let active = 0; for (const g of b.allGroup) if (g.visible) active++;
            const fps = await this.measureFps(800);
            rows.push({ index: i, timeKey: b.timeKeys ? b.timeKeys[i] : String(i), active, updateMs, fps: fps.fps, frameMs: fps.frameMs });
        }
        this._sweepRows = rows;
        this.setSweepStatus("done");
        this.renderSweep(rows);
        return rows;
    },

    renderSweep(rows) {
        const host = document.getElementById("bench-sweep-table");
        if (!host) return;
        const cols = [
            ["timeKey", "Time point", "슬라이더 시점(타임스탬프)"],
            ["active", "Active objects", "그 시점에 화면에 표시되는 객체 수"],
            ["updateMs", "Update latency (ms)", "슬라이더 한 칸 이동 후 화면 갱신까지 걸린 시간"],
            ["fps", "Frame rate (fps)", "그 상태에서의 초당 렌더 프레임 수"],
        ];
        const th = cols.map(c => `<th style="text-align:right;padding:3px 6px;border-bottom:2px solid #334155;white-space:nowrap">${c[1]}</th>`).join("");
        const body = rows.map(r => "<tr>" + cols.map((c, idx) =>
            `<td style="text-align:${idx === 0 ? "left" : "right"};padding:3px 6px;border-bottom:1px solid #e2e8f0;white-space:nowrap">${r[c[0]]}</td>`).join("") + "</tr>").join("");
        const legend = cols.map(c => `<div><b>${c[1]}</b> — ${c[2]}</div>`).join("");
        host.innerHTML =
            `<table style="border-collapse:collapse;width:100%;font-size:11px"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
             <div style="margin-top:6px;font-size:10px;color:#64748b;line-height:1.6">${legend}</div>`;
    },

    exportSweepCsv() {
        const rows = this._sweepRows || [];
        if (!rows.length) { this.setSweepStatus("run the sweep first"); return; }
        const header = [
            "# Time point: slider timestamp",
            "# active: number of objects displayed at that timestamp (active objects)",
            "# updateMs: scene-update latency after one slider step (ms)",
            "# fps: render frame rate at that state; frameMs: mean frame time (ms)",
            "timeKey,active,updateMs,fps,frameMs",
        ].join("\n");
        const body = rows.map(r => [r.timeKey, r.active, r.updateMs, r.fps, r.frameMs].join(",")).join("\n");
        const blob = new Blob([header + "\n" + body], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "scalability_timepoint_sweep.csv";
        a.click();
        URL.revokeObjectURL(a.href);
    },
    togglePanel() {
        this.ensurePanel();
        const panel = document.getElementById("bench-panel");
        panel.style.display = panel.style.display === "none" ? "block" : "none";
        if (panel.style.display === "block") this.render();
    },

    render() {
        this.ensurePanel();
        const runs = loadRuns();
        // table
        const cols = [
            ["label", "Dataset"], ["objects", "Objects"], ["vertices", "Vertices"],
            ["mb", "MB"], ["fetchMs", "Fetch ms"], ["parseMs", "Parse ms"],
            ["buildMs", "Build ms"], ["totalMs", "Load ms"],
            ["fps", "FPS"], ["frameMs", "Frame ms"], ["heapMB", "Heap MB"],
        ];
        const fmt = (v) => (v == null ? "—" : (typeof v === "number" ? v.toLocaleString() : v));
        const th = cols.map(c => `<th style="text-align:right;padding:3px 6px;border-bottom:2px solid #334155;white-space:nowrap">${c[1]}</th>`).join("");
        const rows = runs.map(r => "<tr>" + cols.map((c, i) =>
            `<td style="text-align:${i === 0 ? "left" : "right"};padding:3px 6px;border-bottom:1px solid #e2e8f0;white-space:nowrap">${fmt(r[c[0]])}</td>`).join("") + "</tr>").join("");
        document.getElementById("bench-table").innerHTML =
            `<table style="border-collapse:collapse;width:100%;font-size:11px"><thead><tr>${th}</tr></thead><tbody>${rows || `<tr><td colspan="${cols.length}" style="padding:8px;color:#94a3b8">No runs yet — load ×1, ×4, ×9, ×16 in turn.</td></tr>`}</tbody></table>`;
        // chart: object count vs latency
        const pts = runs.slice().sort((a, b) => a.objects - b.objects);
        const mk = (key) => pts.map(r => ({ x: r.objects, y: r[key] }));
        const cv = document.getElementById("bench-chart");
        if (this._chart) this._chart.destroy();
        this._chart = new Chart(cv, {
            type: "line",
            data: {
                datasets: [
                    { label: "Load latency (ms)", data: mk("totalMs"), borderColor: "#2563eb", backgroundColor: "#2563eb", yAxisID: "y", tension: 0.2, pointRadius: 4 },
                    { label: "Build (ms)", data: mk("buildMs"), borderColor: "#16a34a", backgroundColor: "#16a34a", yAxisID: "y", tension: 0.2, pointRadius: 3, borderDash: [5, 4] },
                    { label: "Frame time (ms)", data: mk("frameMs"), borderColor: "#dc2626", backgroundColor: "#dc2626", yAxisID: "y1", tension: 0.2, pointRadius: 4 },
                ]
            },
            options: {
                responsive: true, animation: false,
                interaction: { mode: "nearest", intersect: false },
                plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } }, title: { display: false } },
                scales: {
                    x: { type: "linear", title: { display: true, text: "Object count" }, ticks: { font: { size: 10 } } },
                    y: { type: "linear", position: "left", title: { display: true, text: "Load / Build (ms)" }, beginAtZero: true, ticks: { font: { size: 10 } } },
                    y1: { type: "linear", position: "right", title: { display: true, text: "Frame time (ms)" }, beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } },
                }
            }
        });
    },

    exportCsv() {
        const runs = loadRuns();
        const cols = ["label", "objects", "vertices", "triangles", "mb", "fetchMs", "parseMs", "buildMs", "totalMs", "fps", "frameMs", "worstFrameMs", "heapMB"];
        const head = cols.join(",");
        const body = runs.map(r => cols.map(c => r[c] == null ? "" : r[c]).join(",")).join("\n");
        const blob = new Blob([head + "\n" + body], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "scalability_benchmark.csv";
        a.click();
        URL.revokeObjectURL(a.href);
    },
    exportPng() {
        if (!this._chart) return;
        const a = document.createElement("a");
        a.href = this._chart.toBase64Image("image/png", 1);
        a.download = "scalability_chart.png";
        a.click();
    },
};

if (typeof window !== "undefined") window.Bench = Bench;
