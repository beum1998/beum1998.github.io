// ─────────────────────────────────────────────────────────────────────────────
// 녹음 탭 (Recording tab)
//
// Revit 애드인(AdvancedBIMLog)이 만든 녹음 파일을 불러와 타임라인과 동기 재생한다.
//   · .wav            : 실제 오디오
//   · *_rec.json      : 시작 파일 (StartTime / EndTime / AudioFile / Pauses / Title / Kind / Note)
//
// 재생 원리:
//   타임라인 키(timeKeys)는 실제 시각(yyyy_MM_dd_HH_mm_ss)이다. 오디오가 흐르면
//   "현재 실제 시각 = 녹음 시작시각 + 오디오 경과초 + 그때까지의 일시정지 시간" 을 계산하고,
//   그 시각 이하의 가장 최근 timeKey 로 타임슬라이더를 옮긴다. 녹음 종료 시각에 도달하면 정지.
//   (모델 변경이 없는 구간에서는 슬라이더가 그대로 머문다 — 이벤트 기반 타임라인이라 정상)
//
// 녹음 구간은 하단 타임라인 아래에도 표시되고, 그 구간을 눌러도 재생된다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, emit, escapeHtml, fetchJsonRetry, onProjectReset } from "./store.js";
import { icon } from "./icons.js";
import {
    summarizeRecording, getTranscript, hasKey, saveKey,
    getTranscribeModel, setTranscribeModel, getModel, TRANSCRIBE_PRESETS, sectionize,
} from "./aiSummary.js";
import { expand, morph } from "./motion.js";
import { mountRating, plainText } from "./rating.js";
import { checkNumbers, checkBarHtml, wireCheckToggle } from "./numberCheck.js";

let recordings = [];      // { name, url, startMs, endMs, durationSec, meta, pauses }
let audio = null;         // HTMLAudioElement
let syncRaf = 0;          // requestAnimationFrame id
let current = null;       // 현재 재생 중인 recording
let cachedKeys = null;    // timeKeys 참조 캐시
let cachedKeyMs = null;   // timeKey → ms 배열

// "yyyy-MM-dd HH:mm:ss" (녹음 메타) → ms
function recTimeToMs(s) {
    if (!s) return NaN;
    const m = s.trim().match(/(\d{4})[-_](\d{2})[-_](\d{2})[ _](\d{2})[:_](\d{2})[:_](\d{2})/);
    if (!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

// 일시정지 구간 정규화: [{ AudioOffsetSec, DurationSec }] → [{ off, dur }] (오프셋 오름차순)
function normPauses(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((p) => ({
            off: Number(p.AudioOffsetSec ?? p.audioOffsetSec ?? p.off),
            dur: Number(p.DurationSec ?? p.durationSec ?? p.dur),
        }))
        .filter((p) => isFinite(p.off) && isFinite(p.dur) && p.dur > 0)
        .sort((a, b) => a.off - b.off);
}

// 오디오 경과(audioSec)까지 쌓인 정지 시간(초) — 오디오시간→실제(타임라인)시간 보정용
function pausedBeforeSec(pauses, audioSec) {
    let s = 0;
    for (const p of pauses || []) {
        if (p.off <= audioSec) s += p.dur;
        else break;
    }
    return s;
}

// "yyyy_MM_dd_HH_mm_ss" (타임라인 키 / 파일명) → ms
function keyToMs(k) {
    const p = k.split("_");
    if (p.length < 6) return NaN;
    return new Date(+p[0], +p[1] - 1, +p[2], +p[3], +p[4], +p[5]).getTime();
}

// 파일명에서 앞쪽 타임스탬프 추출 → ms (메타가 없을 때 대비)
function fileNameToStartMs(name) {
    const m = name.match(/(\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2})/);
    return m ? keyToMs(m[1]) : NaN;
}

function fmtClock(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtStartLabel(ms) {
    if (!isFinite(ms)) return "(시각 없음)";
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} `
        + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtShort(ms) {
    if (!isFinite(ms)) return "—";
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 녹음 창(Revit)에서 적어 둔 기본 정보 — 이름 · 종류 · 메모
function infoOf(meta) {
    const t = (v) => String(v || "").trim();
    return { recTitle: t(meta && meta.Title), kind: t(meta && meta.Kind), note: t(meta && meta.Note) };
}

// ── 녹음 이름: 녹음 창에서 적은 이름이 기본, 여기서 고치면 그 값이 우선 ──
//    사용자가 고친 이름은 브라우저 localStorage 에 오디오 파일명으로 저장해
//    전처리로 데이터가 갱신돼도 남는다.
const REC_NAME_KEY = "abl_rec_names";
function loadRecNames() {
    try { return JSON.parse(localStorage.getItem(REC_NAME_KEY) || "{}"); } catch { return {}; }
}
function defaultName(rec) {
    return (rec.recTitle || "").trim() || fmtStartLabel(rec.startMs);
}
function getName(rec) {
    const m = loadRecNames();
    const n = m[rec.name];
    return (n && n.trim()) ? n.trim() : defaultName(rec);
}
function setName(rec, name) {
    const m = loadRecNames();
    name = (name || "").replace(/\s+/g, " ").trim();
    if (name && name !== defaultName(rec)) m[rec.name] = name;
    else delete m[rec.name];   // 기본값(녹음 창에서 적은 이름 · 시각)과 같거나 비면 저장 안 함
    try { localStorage.setItem(REC_NAME_KEY, JSON.stringify(m)); } catch { }
    rec.displayName = getName(rec);
}

// 현재 로드된 타임라인(timeKeys)과 그 ms 배열을 가져온다(모델 로드 후에만 존재)
function getTimeline() {
    const bench = window.__fvBench;
    if (!bench || !Array.isArray(bench.timeKeys) || bench.timeKeys.length === 0) return null;
    if (cachedKeys !== bench.timeKeys) {
        cachedKeys = bench.timeKeys;
        cachedKeyMs = bench.timeKeys.map(keyToMs);
    }
    return { slider: bench.slider || document.getElementById("fully-slider"), keys: cachedKeys, keyMs: cachedKeyMs };
}

// nowMs 이하의 가장 최근 timeKey 인덱스 (없으면 0, 전부 이전이면 마지막)
function indexForMs(keyMs, nowMs) {
    let idx = 0;
    for (let i = 0; i < keyMs.length; i++) {
        if (keyMs[i] <= nowMs) idx = i;
        else break;
    }
    return idx;
}

// 타임슬라이더를 특정 인덱스로 이동시키고 3D/정보 패널을 갱신
function moveSlider(slider, idx) {
    if (!slider) return;
    if (parseInt(slider.value, 10) === idx) return;
    slider.value = idx;
    slider.dispatchEvent(new Event("input"));   // 메쉬/정보/배경 갱신 (slider.js 리스너)
}

// ── 재생 / 정지 ─────────────────────────────────────────────────────────────
function stopPlayback() {
    cancelAnimationFrame(syncRaf);
    syncRaf = 0;
    if (audio) { audio.pause(); }
    const was = current;
    current = null;
    if (was) markRowPlaying(was, false);
    updateNowPlaying(null);
    updateProgress(null);
}

function playRecording(rec) {
    if (!audio) return;
    // 이전 재생 정리
    cancelAnimationFrame(syncRaf);
    const prev = current;
    current = rec;
    if (prev && prev !== rec) markRowPlaying(prev, false);
    markRowPlaying(rec, true);
    updateNowPlaying(rec);

    audio.src = rec.url;
    audio.currentTime = 0;

    // 시작 시점으로 타임슬라이더 이동
    const tl = getTimeline();
    if (tl && isFinite(rec.startMs)) {
        moveSlider(tl.slider, indexForMs(tl.keyMs, rec.startMs));
    }

    const onMeta = () => {
        // 메타에 EndTime 이 없으면 오디오 길이로 종료 시각을 정한다
        if (!isFinite(rec.endMs) && isFinite(rec.startMs)) {
            rec.endMs = rec.startMs + audio.duration * 1000;
        }
        if (!isFinite(rec.durationSec)) rec.durationSec = audio.duration;
    };
    audio.addEventListener("loadedmetadata", onMeta, { once: true });

    audio.play().then(() => { syncLoop(); updateNowPlaying(rec); }).catch((e) => {
        console.warn("[recording] 재생 실패:", e);
        setStatus("오디오를 재생하지 못했어요.");
    });
}

function syncLoop() {
    cancelAnimationFrame(syncRaf);
    const tick = () => {
        if (!current || audio.paused) return;
        const rec = current;
        // 오디오 경과 + (그 지점까지의 정지 시간) = 실제 흐른 시간 → 타임라인 매핑
        const audioSec = audio.currentTime;
        const realSec = audioSec + pausedBeforeSec(rec.pauses, audioSec);
        const nowMs = isFinite(rec.startMs) ? rec.startMs + realSec * 1000 : NaN;

        // 타임슬라이더를 현재 시각에 맞춰 이동
        const tl = getTimeline();
        if (tl && isFinite(nowMs)) moveSlider(tl.slider, indexForMs(tl.keyMs, nowMs));

        updateProgress(rec);

        // 종료 시각 도달 시 정지
        if (isFinite(rec.endMs) && isFinite(nowMs) && nowMs >= rec.endMs) {
            stopPlayback();
            return;
        }
        syncRaf = requestAnimationFrame(tick);
    };
    syncRaf = requestAnimationFrame(tick);
}

// ── 파일 로딩 ───────────────────────────────────────────────────────────────
// wav 목록 + json 목록을 매칭해서 recordings 배열을 만든다
async function buildRecordings(wavFiles, jsonFiles) {
    const metas = [];
    for (const jf of jsonFiles) {
        try {
            const text = await jf.text();
            const meta = JSON.parse(text);
            metas.push({ base: jf.name.replace(/_rec\.json$/i, "").replace(/\.json$/i, ""), meta });
        } catch (e) { /* skip */ }
    }

    const out = [];
    for (const wf of wavFiles) {
        const wavBase = wf.name.replace(/\.wav$/i, "");
        // 메타 매칭: AudioFile === wav 이름, 또는 basename 일치
        const byAudio = metas.find(m => (m.meta.AudioFile || "").toLowerCase() === wf.name.toLowerCase());
        const byBase = metas.find(m => m.base.toLowerCase() === wavBase.toLowerCase());
        const meta = (byAudio || byBase)?.meta || null;

        const startMs = meta ? recTimeToMs(meta.StartTime) : fileNameToStartMs(wf.name);
        const endMs = meta ? recTimeToMs(meta.EndTime) : NaN;
        const durationSec = (isFinite(startMs) && isFinite(endMs)) ? (endMs - startMs) / 1000 : NaN;

        out.push({
            name: wf.name,
            url: URL.createObjectURL(wf),
            startMs, endMs, durationSec, meta,
            ...infoOf(meta),
            pauses: normPauses(meta && meta.Pauses),
        });
    }
    out.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    return out;
}

function setRecordings(list) {
    for (const r of recordings) { try { if (r.url.startsWith("blob:")) URL.revokeObjectURL(r.url); } catch (e) {} }
    recordings = list;
    for (const r of recordings) r.displayName = getName(r);
    store.recordings = recordings;
    renderList();
    emit("recordings", recordings);
}

// 다중 파일 선택 (폴백)
async function loadFromFiles(fileList) {
    const files = Array.from(fileList || []);
    const wavFiles = files.filter(f => /\.wav$/i.test(f.name));
    const jsonFiles = files.filter(f => /\.json$/i.test(f.name));
    if (wavFiles.length === 0) { setStatus("선택한 항목에 .wav 파일이 없어요."); return; }
    setRecordings(await buildRecordings(wavFiles, jsonFiles));
    setStatus(`녹음 ${wavFiles.length}개`);
}

// recordings.json 매니페스트(전처리가 최종로그에 생성) → URL 기반 recording 목록
function buildFromManifest(baseUrl, manifest) {
    const out = [];
    for (const e of manifest) {
        const name = e.AudioFile || e.audio;
        if (!name) continue;
        let startMs = recTimeToMs(e.StartTime || e.startTime);
        if (!isFinite(startMs)) startMs = fileNameToStartMs(name);
        const endMs = recTimeToMs(e.EndTime || e.endTime);
        const durationSec = (isFinite(startMs) && isFinite(endMs)) ? (endMs - startMs) / 1000 : NaN;
        out.push({
            name, url: baseUrl + encodeURIComponent(name), startMs, endMs, durationSec, meta: e,
            ...infoOf(e), pauses: normPauses(e.Pauses),
        });
    }
    out.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    return out;
}

// ── 외부(index.html)에서 부르는 진입점 ───────────────────────────────────────

/** Input Folder로 고른 폴더의 파일들(File[])에서 녹음을 자동 연결 */
export function loadRecordingsFromFiles(fileList) {
    const files = Array.from(fileList || []);
    const hasRec = files.some(f => /\.wav$/i.test(f.name));
    if (!hasRec) return;           // 녹음이 없으면 조용히 지나감(로그 폴더에 녹음이 없을 수 있음)
    return loadFromFiles(files);
}

/** ./src/finalLogs/recordings.json 매니페스트를 fetch 해서 자동 연결(페이지 로드 시) */
export async function loadRecordingsAuto(baseUrl) {
    try {
        const manifest = await fetchJsonRetry(baseUrl + "recordings.json");
        if (!Array.isArray(manifest) || manifest.length === 0) return;
        setRecordings(buildFromManifest(baseUrl, manifest));
        setStatus(`녹음 ${manifest.length}개 · 자동 연결됨`);
    } catch (e) { /* 매니페스트 없음 → 건너뜀 */ }
}

// ── UI ──────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function setStatus(msg) { const s = el("rec-status"); if (s) s.textContent = msg || ""; }

function playToggle(rec) {
    if (!rec) return;
    if (current === rec && audio && !audio.paused) {
        audio.pause();                     // 재생 중 → 일시정지
    } else if (current === rec && audio && audio.paused && audio.src) {
        audio.play().then(syncLoop);       // 이어재생
    } else {
        playRecording(rec);                // 다른 항목 → 처음부터
        return;
    }
    markRowPlaying(rec, true);
    updateNowPlaying(rec);
}

function renderList() {
    const listEl = el("rec-list");
    if (!listEl) return;
    const count = el("rec-count");
    if (count) { count.textContent = recordings.length ? String(recordings.length) : ""; count.hidden = !recordings.length; }

    if (recordings.length === 0) {
        listEl.innerHTML = `
            <div class="empty">
                <div class="empty__icon tone-rec">${icon("mic", 22)}</div>
                <div class="empty__title">연결된 녹음이 없어요</div>
                <p class="empty__text">Revit 리본의 <b>기록 › 녹음 시작</b>으로 설명하며 모델링한 뒤,
                저장하고 <b>전처리</b>를 실행하면 여기에 자동으로 나타나요.</p>
            </div>`;
        return;
    }
    listEl.innerHTML = "";
    recordings.forEach((rec, i) => {
        const row = document.createElement("div");
        row.className = "rec-row";
        row.dataset.idx = i;

        const dur = isFinite(rec.durationSec) ? fmtClock(rec.durationSec) : "--:--";
        const pauseCount = (rec.pauses || []).length;

        row.innerHTML = `
            <button class="rec-play-btn" type="button" title="재생 / 일시정지">${icon("play", 15)}</button>
            <div class="rec-body">
                <span class="rec-title" contenteditable="true" spellcheck="false" title="클릭해서 이름 바꾸기 (자동 저장)"></span>
                ${rec.note ? `<p class="rec-note" title="${escapeHtml(rec.note)}">${escapeHtml(rec.note)}</p>` : ""}
                <div class="rec-meta">
                    ${rec.kind ? `<span class="rec-kind tag tag--line">${escapeHtml(rec.kind)}</span>` : ""}
                    <span>${icon("clock", 12)}${fmtShort(rec.startMs)}${isFinite(rec.endMs) ? ` – ${fmtShort(rec.endMs).slice(6)}` : ""}</span>
                    ${pauseCount ? `<span>일시정지 ${pauseCount}회</span>` : ""}
                    ${getTranscript(rec) ? `<span>${icon("edit", 12)}전사됨</span>` : ""}
                </div>
            </div>
            <button class="rec-ai-btn btn btn--xs btn--soft" type="button" title="이 녹음을 전사해서, 말한 내용과 실제 변경을 대조해요">${icon("sparkle", 13)}AI</button>
            <span class="rec-dur tag tag--md tag--num">${dur}</span>
            <div class="rec-ai" hidden></div>`;

        const playBtn = row.querySelector(".rec-play-btn");
        const title = row.querySelector(".rec-title");
        title.textContent = getName(rec);

        playBtn.addEventListener("click", (e) => { e.stopPropagation(); playToggle(rec); });
        row.querySelector(".rec-ai-btn").addEventListener("click", (e) => { e.stopPropagation(); runRecAi(row, rec); });
        row.addEventListener("click", (e) => {
            if (e.target.closest(".rec-title") || e.target.closest(".rec-ai")) return;
            playToggle(rec);
        });

        // 이름 변경 → 자동 저장
        title.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); title.blur(); }
            e.stopPropagation();
        });
        title.addEventListener("blur", () => {
            setName(rec, title.textContent);
            title.textContent = getName(rec);   // 정규화된 이름으로 표시
            updateNowPlaying(current);
        });

        // 목록을 다시 그려도 펼쳐 둔 AI 요약은 그대로 (첫 요약 직후 "전사됨" 갱신에서 사라지던 문제)
        if (recAiCache.has(rec.name)) showRecAi(row.querySelector(".rec-ai"), row, rec, { animate: false });

        listEl.appendChild(row);
    });
    if (current) markRowPlaying(current, !audio.paused);
}

// ── 녹음 AI 요약 ────────────────────────────────────────────────────────────
const recAiCache = new Map();   // rec.name → 요약 HTML
onProjectReset(() => recAiCache.clear());   // 녹음 파일 이름은 프로젝트마다 겹칠 수 있다

/** AI 패널 내용 교체 — 닫혀 있으면 펼치고, 열려 있으면 높이를 이어서 흐르게 한다. */
function paintAi(box, html) {
    if (box.hidden) { box.innerHTML = html; expand(box); }
    else morph(box, () => { box.innerHTML = html; });
}

/** 저장해 둔 요약을 행의 AI 칸에 그린다. */
function showRecAi(box, row, rec, { animate = true } = {}) {
    const cached = recAiCache.get(rec.name);
    if (animate) paintAi(box, recAiResult(rec, cached));
    else { box.innerHTML = recAiResult(rec, cached); box.hidden = false; }
    mountRecRating(box, rec, cached.html, cached.check?.stats);
    wireCheckToggle(box);
    wireRecAi(box, row, rec);
}

async function runRecAi(row, rec) {
    const box = row.querySelector(".rec-ai");
    if (!box) return;

    if (recAiCache.has(rec.name)) {
        showRecAi(box, row, rec);
        return;
    }
    if (!hasKey()) {
        paintAi(box, `
            <div class="rec-ai__key">
                <span>OpenAI API 키를 입력하면 녹음을 전사해 요약해요. 키는 이 브라우저에만 저장돼요.</span>
                <div class="rec-ai__key-row field-row">
                    <input class="field field--sm" type="password" placeholder="sk-..." autocomplete="off" spellcheck="false" data-rec-key>
                    <button class="btn btn--sm btn--primary" type="button" data-rec-act="key">저장</button>
                </div>
            </div>`);
        wireRecAi(box, row, rec);
        box.querySelector("[data-rec-key]")?.focus();
        return;
    }

    const known = getTranscript(rec);
    paintAi(box, `<div class="rec-ai__loading busy"><span class="spinner"></span>${known ? "요약하는 중…" : "녹음을 전사하고 요약하는 중…"}</div>`);
    try {
        const { html, transcript, facts } = await summarizeRecording(rec);
        const check = checkNumbers(html, facts);
        recAiCache.set(rec.name, { html, transcript, check });
        if (known) showRecAi(box, row, rec);
        else renderList();   // 처음 전사한 녹음 — "전사됨" 표시를 갱신하며 요약도 함께 다시 그린다
    } catch (e) {
        paintAi(box, `<div class="rec-ai__error notice notice--plain tone-del">${escapeHtml(e.message || "요약에 실패했어요.")}</div>`);
        wireRecAi(box, row, rec);
    }
}

function recAiResult(rec, { html, transcript, check }) {
    return `
        <div class="rec-ai__body">${sectionize(check ? check.html : html)}</div>
        ${check ? checkBarHtml(check.stats) : ""}
        <div class="rate"></div>
        <details class="rec-ai__script disc"><summary>${icon("chevronRight", 12)}전사 원문</summary><p>${escapeHtml(transcript)}</p></details>
        <div class="rec-ai__foot">
            <span class="rec-ai__model">${escapeHtml(getTranscribeModel())} · ${escapeHtml(getModel())}</span>
            <button class="btn btn--ghost btn--xs" type="button" data-rec-act="again">${icon("refresh", 12)}다시 요약</button>
        </div>`;
}

/** 녹음 요약에도 평가를 붙인다 — 핀 요약과 같은 CSV 로 모인다. */
function mountRecRating(box, rec, html, check = null) {
    const host = box.querySelector(".rate");
    if (!host) return;
    mountRating(host, {
        kind: "recording",
        id: rec.name,
        meta: {
            title: rec.displayName || rec.name,
            timestamp: Number.isFinite(rec.startMs) ? new Date(rec.startMs).toISOString() : "",
            from: "", to: "",
            model: getModel(),
            summarizedAt: Date.now(),
            summary: plainText(html),
            check,
        },
    });
}

function wireRecAi(box, row, rec) {
    box.onclick = (e) => {
        const act = e.target.closest("[data-rec-act]")?.dataset.recAct;
        if (!act) return;
        e.stopPropagation();
        if (act === "again") { recAiCache.delete(rec.name); runRecAi(row, rec); }
        else if (act === "key" && saveKey(box.querySelector("[data-rec-key]")?.value)) runRecAi(row, rec);
    };
    box.onkeydown = (e) => {
        if (e.key !== "Enter" || !e.target.matches("[data-rec-key]")) return;
        e.preventDefault();
        if (saveKey(e.target.value)) runRecAi(row, rec);
    };
}

function markRowPlaying(rec, on) {
    const listEl = el("rec-list");
    if (!listEl) return;
    const i = recordings.indexOf(rec);
    const row = listEl.querySelector(`.rec-row[data-idx="${i}"]`);
    if (!row) return;
    const playing = !!on && audio && !audio.paused;
    row.classList.toggle("is-current", current === rec);
    row.classList.toggle("playing", playing);
    const btn = row.querySelector(".rec-play-btn");
    if (btn) btn.innerHTML = icon(playing ? "pause" : "play", 15);
}

function updateNowPlaying(rec) {
    const player = el("rec-player");
    const np = el("rec-now");
    const sub = el("rec-now-sub");
    const toggle = el("rec-toggle");
    const playing = !!rec && audio && !audio.paused;
    player?.classList.toggle("is-active", !!rec);
    player?.classList.toggle("is-playing", playing);
    if (np) np.textContent = rec ? getName(rec) : "재생 중인 녹음이 없어요";
    if (sub) sub.textContent = rec ? (playing ? "재생 중 · 타임라인이 따라 움직여요" : "일시정지됨") : "목록에서 녹음을 골라 재생하세요";
    if (toggle) {
        toggle.innerHTML = icon(playing ? "pause" : "play", 16);
        toggle.disabled = !rec;
    }
}

function updateProgress(rec) {
    const bar = el("rec-progress-bar");
    const lab = el("rec-progress-label");
    if (!audio) return;
    if (!rec) {
        if (bar) bar.style.width = "0%";
        if (lab) lab.textContent = "00:00 / --:--";
        return;
    }
    const cur = audio.currentTime;
    // 진행바는 실제 오디오 길이 기준(일시정지가 있으면 wall-clock 보다 짧다)
    const total = (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : rec.durationSec;
    if (bar && isFinite(total) && total > 0) bar.style.width = `${Math.min(100, (cur / total) * 100)}%`;
    if (lab) lab.textContent = `${fmtClock(cur)} / ${isFinite(total) ? fmtClock(total) : "--:--"}`;
}

export function initRecordingTab() {
    if (window.__recInit) return;   // 중복 초기화 방지
    window.__recInit = true;

    audio = new Audio();
    audio.addEventListener("ended", stopPlayback);
    audio.addEventListener("pause", () => { if (current) { markRowPlaying(current, false); updateNowPlaying(current); } });
    audio.addEventListener("play", () => { if (current) { markRowPlaying(current, true); updateNowPlaying(current); } });

    el("rec-stop")?.addEventListener("click", stopPlayback);
    el("rec-toggle")?.addEventListener("click", () => { if (current) playToggle(current); });

    // 진행바 클릭 → 그 위치로 이동
    el("rec-progress")?.addEventListener("click", (e) => {
        if (!current || !audio || !isFinite(audio.duration)) return;
        const r = e.currentTarget.getBoundingClientRect();
        audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
        updateProgress(current);
        if (!audio.paused) syncLoop();
    });

    store.playRecording = (rec) => { store.setTab?.("record"); playToggle(rec); };

    // 전사 모델 선택 (목록에 없으면 직접 입력)
    const stt = el("ai-stt-model");
    const sttList = el("ai-stt-list");
    if (stt && sttList) {
        const current = getTranscribeModel();
        const items = TRANSCRIBE_PRESETS.some((m) => m.id === current)
            ? TRANSCRIBE_PRESETS
            : [{ id: current, label: "" }, ...TRANSCRIBE_PRESETS];
        sttList.innerHTML = items.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label || "")}</option>`).join("");
        stt.value = current;
        stt.addEventListener("change", () => setTranscribeModel(stt.value));
        stt.addEventListener("blur", () => { if (!stt.value.trim()) stt.value = getTranscribeModel(); });
    }

    renderList();
    updateNowPlaying(null);
    updateProgress(null);
}
