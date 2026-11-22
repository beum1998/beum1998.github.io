// ─────────────────────────────────────────────────────────────────────────────
// AI 변경 요약 (시점별 비교 해석)
//
// 두 시점 사이의 변화를 AI가 문장으로 풀어준다. 원칙은 하나다:
//   · 숫자(물량 · 개수 · 층×카테고리 변화)는 코드가 계산해서 그대로 넘긴다.
//   · 형상은 렌더한 화면 이미지와 요소의 카테고리 · 타입 · 층 정보로 넘긴다.
//   · AI는 계산하지 않고 해석과 서술만 한다. 핀 메모와 실제 변경이 어긋나면 짚는다.
//
// 진입점
//   1) 비교 탭   — 지금 보고 있는 A · B 두 화면을 그대로 캡처해 요약
//   2) 핀 카드   — 이전 핀 대비 변화를, 그 시점 모델의 남 · 동 · 북 · 서 · 상부
//                  다섯 장(+ 이전 핀 정면 한 장)과 함께 요약
//   3) 브리핑 · 녹음 · 프로젝트 서술
//   핀 · 비교는 바뀐 층의 변경 전 · 후 평면도 함께 보낸다(수직 요소가 바뀌면 인접 층까지).
//   핀은 그 층에서 구간 안에 만들고 지운 요소가 있으면 그것을 그린 평면도 한 장 더 보낸다.
//
// 구간의 분류와 수치(수정됨 · 결과값만 변경 · 함께 갱신 · 경로 수치 · 변경 순서 · 전파 표시)는
// segment.js 한곳에서 나온다. 여기서는 그것을 AI 에 보낼 모양으로 옮기기만 한다.
//
// 결과 형식(모든 진입점 공통) — 사실과 해석을 나눈다
//   Observed Change           로그 · 수치 · 도면에서 직접 확인되는 것
//   Spatial Impact            층 · 방위 · 공간 구성 · 물량에 미친 영향
//   Inferred Design Decision  위 둘을 근거로 한 해석 + 근거 · 확신
//
// 숫자의 키 — 숫자 검사가 답변의 숫자를 어느 계산 항목과 견줄지 답변이 직접 밝히게 한다
//   · 보내는 데이터의 숫자마다 바로 뒤에 키가 붙는다: "추가":"56[#k3]" (numberCheck.keyContext)
//   · 지시문은 데이터의 숫자를 쓸 때 그 키를 숫자 뒤에 그대로 옮기라고 한다: "벽 56[#k3]개 추가"
//   · 저장은 두 벌 — html(키를 지운 글, 화면 · 보고서 · 평가가 읽는다)과 keyed(키가 붙은 글, 숫자 검사가 읽는다)
//   화면에 보이는 글은 키가 없던 때와 같다. 키가 없는 숫자는 숫자 검사가 둘레의 낱말로 묶는다.
//
// API 키는 기존 비교 화면(compare.html)과 같은 브라우저 저장소를 쓴다.
// 요약을 누를 때만 외부로 전송되며, 그 외 기능은 모두 오프라인으로 동작한다.
// ─────────────────────────────────────────────────────────────────────────────

import { Color } from "three";
import { store, on, catInfo, levelOf, formatKey, escapeHtml, LAB } from "./store.js";
import { icon } from "./icons.js";
import { pinAtIndex } from "./pins.js";
import { captureViews, captureLevelPlans, planLevels, planLevelOf, inLevelPlan, VIEWS } from "./shoot.js";
import { expand, morph } from "./motion.js";
import { mountRating, plainText, getRating, VERDICTS, VERDICT_TONE } from "./rating.js";
import { safeHtml } from "./sanitize.js";
import { summarizeModifications } from "./changeDiff.js";
import { segmentAccount, segmentRework, classifyDiff, changeSequence, pinRange, sequenceRows } from "./segment.js";
import { collectFacts, keyContext, stripKeys, checkNumbers, checkBarHtml, checkTagHtml, wireCheckToggle } from "./numberCheck.js";

const KEY_STORAGE = "openai_api_key";   // 기존 비교 화면과 같은 키
const MODEL_STORAGE = "abl_ai_model";
const MODEL_LIST_STORAGE = "abl_ai_model_list";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const DEFAULT_MODEL = "gpt-5.6-terra";
// 키가 없을 때 보여줄 기본 후보. 키가 있으면 계정에서 실제 쓸 수 있는 모델로 채운다.
// (이미지를 읽는 모델이어야 5방향 화면을 해석할 수 있다)
const PRESET_MODELS = [
    { id: "gpt-6-astra", label: "GPT-6 Astra — 가장 강력" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol — 복잡한 작업" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra — 성능·비용 균형 (기본)" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna — 저비용" },
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini — 가볍고 빠름" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini — 구형·저렴" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini — 구형·저렴" },
];
const IMAGE_WIDTH = 640;

// 녹음 전사 (말한 내용 → 글)
const TRANSCRIBE_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIBE_STORAGE = "abl_ai_stt_model";
const TRANSCRIPT_STORAGE = "abl_rec_transcripts";
const SEND_TRANSCRIPT_STORAGE = "abl_ai_send_transcript";
const DEFAULT_TRANSCRIBE = "gpt-transcribe";
export const TRANSCRIBE_PRESETS = [
    { id: "gpt-transcribe", label: "GPT-Transcribe — 고정확도 (기본)" },
    { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe" },
    { id: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe — 저렴" },
    { id: "whisper-1", label: "Whisper — 구형" },
];

const ADDED = 0x22c55e;
const MODIFIED = 0xf59e0b;

const HEADLINE_METRICS = {
    "All Numbers": "개수",
    "All Volume": "전체 체적",
    "All Length": "전체 길이",
    "Column Length": "기둥 길이",
    "Column Volume": "기둥 체적",
    "Stair Length": "계단 길이",
    "Railing Length": "난간 길이",
};

// ── API 키 ───────────────────────────────────────────────────────────────────
export function getKey() {
    try { return (localStorage.getItem(KEY_STORAGE) || "").trim() || null; } catch { return null; }
}
export function hasKey() { return Boolean(getKey()); }
export function saveKey(value) {
    const v = (value || "").trim();
    if (!v) return false;
    try { localStorage.setItem(KEY_STORAGE, v); } catch { return false; }
    return true;
}

// ── 사용할 모델 ──────────────────────────────────────────────────────────────
export function getModel() {
    try { return (localStorage.getItem(MODEL_STORAGE) || "").trim() || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
}
export function setModel(value) {
    const v = (value || "").trim();
    if (!v) return;
    try { localStorage.setItem(MODEL_STORAGE, v); } catch { }
}
function cachedModelList() {
    try {
        const saved = JSON.parse(localStorage.getItem(MODEL_LIST_STORAGE) || "null");
        return Array.isArray(saved?.ids) && saved.ids.length ? saved.ids : PRESET_MODELS;
    } catch { return PRESET_MODELS; }
}
function modelListAge() {
    try {
        const saved = JSON.parse(localStorage.getItem(MODEL_LIST_STORAGE) || "null");
        return saved?.at ? Date.now() - saved.at : Infinity;
    } catch { return Infinity; }
}
/** 계정에서 실제 사용 가능한 모델을 받아온다(대화형 모델만 추려서). */
async function fetchModelList(apiKey) {
    const res = await fetch(MODELS_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(res.status === 401 ? "API 키가 올바르지 않아요." : `목록을 받지 못했어요 (${res.status})`);
    const data = await res.json();
    const ids = (data?.data || [])
        .map((m) => m.id)
        .filter((id) => /^(gpt|o\d|chatgpt)/i.test(id))
        .filter((id) => !/audio|realtime|transcribe|tts|image|embedding|moderation|dall|whisper|sora|live/i.test(id))
        .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));   // 최신 계열이 위로
    if (!ids.length) throw new Error("사용할 수 있는 모델이 없어요.");
    try { localStorage.setItem(MODEL_LIST_STORAGE, JSON.stringify({ ids, at: Date.now() })); } catch { }
    return ids;
}

// ── 근거 데이터 ──────────────────────────────────────────────────────────────
/**
 * 두 기록 시점 사이의 순변화(분류된 차이, segment.js). fromIndex = −1 은 빈 모델.
 * modified 에는 수정됨(순 단계가 입력 값 변경)만 있고, 결과값만 변경 · 바꿨다 되돌림 · 함께 갱신은
 * derivedOnly · restored · incidental 에 따로 있다. 캐시된 값이니 고치지 말 것.
 */
export function diffBetween(fromIndex, toIndex) {
    return segmentAccount(fromIndex, toIndex).diff;
}

export { changeSequence, pinRange };

function levelRows(diff) {
    const rows = new Map();
    const bump = (id, kind) => {
        const g = store.meshDict[id];
        if (!g) return;
        const lv = levelOf(g.userData).name;
        const cat = catInfo(g.userData?.Common?.ElementCategory).label;
        const key = `${lv}|${cat}`;
        if (!rows.has(key)) rows.set(key, { 층: lv, 카테고리: cat, 추가: 0, 삭제: 0, 수정: 0 });
        rows.get(key)[kind]++;
    };
    diff.addedIds.forEach((id) => bump(id, "추가"));
    diff.deletedIds.forEach((id) => bump(id, "삭제"));
    diff.modified.after.forEach((id) => bump(id, "수정"));
    return [...rows.values()];
}

function quantityDeltas(beforeKey, afterKey) {
    const A = store.timeLog[beforeKey]?.Quantity || {};
    const B = store.timeLog[afterKey]?.Quantity || {};
    const cats = [...new Set([...Object.keys(A), ...Object.keys(B)])];
    const out = [];
    for (const cat of cats) {
        const a = A[cat] || {}, b = B[cat] || {};
        for (const [metric, label] of Object.entries(HEADLINE_METRICS)) {
            const va = Number(a[metric]) || 0;
            const vb = Number(b[metric]) || 0;
            if (va === 0 && vb === 0) continue;
            if (Math.abs(vb - va) < 1e-6) continue;
            out.push({
                카테고리: catInfo(cat).label,
                지표: label,
                A: Number(va.toFixed(3)),
                B: Number(vb.toFixed(3)),
                증감: Number((vb - va).toFixed(3)),
            });
        }
    }
    return out;
}

function sampleElements(ids, limit = 8) {
    const out = [];
    for (const id of ids) {
        const g = store.meshDict[id];
        if (!g) continue;
        const c = g.userData?.Common || {};
        out.push({
            카테고리: catInfo(c.ElementCategory).label,
            패밀리: c.ElementFamily || null,
            타입: c.ElementType || null,
            층: levelOf(g.userData).name,
        });
        if (out.length >= limit) break;
    }
    return out;
}

// ── 층 평면 ─────────────────────────────────────────────────────────────────
const DELETED = 0xef4444;
const PLAN_MAX_LEVELS = 2;
// 층을 가로지르는 요소 — 이것이 바뀌면 위 · 아래 층 평면도 함께 본다
const VERTICAL_CATS = new Set(["Stairs", "Columns", "Structural Columns", "Floors", "Curtain Walls", "Railings"]);
/** 만들고 지운 요소를 그린 평면의 이름 끝(이미지 설명 · 근거 · 화면이 같은 말을 쓴다) */
export const TRIAL_PLAN_LABEL = "만들고 지운 요소";

/**
 * 만들고 지운 요소를 칠하는 색 — tokens.css 의 pin 톤(보라)을 그대로 읽는다(화면 범례의 tone-pin 과 같은 값).
 * 추가 초록 · 수정 주황 · 삭제 빨강과 겹치지 않는 색이어야 하고, 지시문(PLAN_NOTE)이 이 색을 "보라"라고 부른다.
 */
function trialColor() {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue("--pin").trim();
        if (v) return new Color(v);
    } catch { }
    return new Color(0x7c5cff);
}

/**
 * 바뀐 층의 변경 전 · 후 평면(diff 는 분류된 차이). 추가 · 삭제 · 수정된 요소와, 구간 안에서 만들고 지운 요소
 * (trialIds, 지워지기 전 마지막 버전)를 합쳐 많은 층부터 두 개까지.
 * 그 층에 만들고 지운 요소가 있으면 한 장 더 찍는다 — 구간 끝의 배치를 회색으로 깔고 그 요소만 칠한다.
 * 그 요소는 구간 양 끝에 없으므로 이전 · 현재 평면에는 나오지 않는다. 이전 · 현재는 서로 같은 틀이고, 이 평면은
 * 그 요소가 다 들어오게 틀을 따로 잡는다(건물 밖에 놓였던 요소 때문에 이전 · 현재 평면이 작아지지 않게).
 * 계단 · 기둥 · 바닥처럼 층을 잇는 요소가 바뀌었으면 가장 많이 바뀐 층의 위 · 아래 층(현재 시점)도 넣는다.
 * 색: 이전 평면은 삭제 빨강 · 수정 주황, 현재 평면은 추가 초록 · 수정 주황, 만들고 지운 요소는 보라.
 * 만들고 지운 요소 가운데 평면에 그리는 것은 그 층의 자르는 높이에 걸리고 모델 범위 안에 놓였던 것뿐이다
 * (shoot.inLevelPlan). 지붕 · 천장, 모델에서 멀리 떨어져 놓였던 요소는 그리지 않고, info 의 수에도 넣지 않는다.
 * @returns {{ images: string[], labels: string[], info: object[], levels: object[] }}
 *   info: 층마다 { 층, 같은_높이의_레벨, 역할, 변경_요소_수, 만들고_지운_요소_수? } — 뒤의 수는 그 평면에 그린 요소 수
 *   levels: 층마다 { key, name, role, before, after, trial } — 화면에 층 순서대로 그릴 때 쓴다(trial 은 없으면 null)
 */
function planShots(fromIndex, toIndex, diff, trialIds = []) {
    const out = { images: [], labels: [], info: [], levels: [] };
    const levels = planLevels();
    if (!levels.length || !store.viewer) return out;

    const count = new Map();
    let vertical = false;
    const bump = (id) => {
        const k = planLevelOf(id);
        if (k) count.set(k, (count.get(k) || 0) + 1);
        if (VERTICAL_CATS.has(store.meshDict[id]?.userData?.Common?.ElementCategory)) vertical = true;
    };
    diff.addedIds.forEach(bump);
    diff.deletedIds.forEach(bump);
    diff.modified.after.forEach(bump);
    // 만들고 지운 요소가 서 있던 평면 층 — 순변화가 없는 층이라도 시도가 있었으면 평면을 고를 때 함께 센다.
    // 그 층 평면에 실제로 그려지는 것만 센다(자르는 높이에 걸리지 않거나 모델에서 멀리 떨어져 놓였던 요소는 뺀다)
    const trial = new Map();
    for (const id of trialIds) {
        const k = planLevelOf(id);
        if (!k || !inLevelPlan(id, k)) continue;
        if (!trial.has(k)) trial.set(k, []);
        trial.get(k).push(id);
    }
    const weight = (k) => (count.get(k) || 0) + (trial.get(k)?.length || 0);
    const changed = [...new Set([...count.keys(), ...trial.keys()])]
        .sort((a, b) => weight(b) - weight(a)).slice(0, PLAN_MAX_LEVELS);
    if (!changed.length) return out;

    const tintOf = (pairs) => {
        const m = new Map();
        for (const [ids, hex] of pairs) for (const id of ids) m.set(id, new Color(hex));
        return m;
    };
    const beforeTint = tintOf([[diff.deletedIds, DELETED], [diff.modified.before, MODIFIED]]);
    const afterTint = tintOf([[diff.addedIds, ADDED], [diff.modified.after, MODIFIED]]);
    const purple = trialColor();
    const nameOf = (k) => levels.find((l) => l.key === k)?.name || k;
    const namesOf = (k) => levels.find((l) => l.key === k)?.names || [k];

    for (const k of changed) {
        const [before, after] = captureLevelPlans({
            levelKey: k,
            shots: [{ index: fromIndex, tint: beforeTint }, { index: toIndex, tint: afterTint }],
        });
        // 만들고 지운 요소의 평면은 따로 찍는다 — 그 요소가 건물에서 떨어진 곳에 놓였더라도 이전 · 현재 평면의 틀(축척)은
        // 그대로 두고, 이 평면만 그 요소가 다 들어오게 넓힌다. 위치는 회색으로 깐 현재 배치에 견줘 읽는다
        const ids = trial.get(k) || [];
        const [tried] = ids.length
            ? captureLevelPlans({ levelKey: k, shots: [{ index: toIndex, extra: ids, dim: true, tint: new Map(ids.map((id) => [id, purple])) }] })
            : [];
        const paired = Boolean(before && after);   // 구간 양 끝 모두 이 층에 요소가 없으면 이전 · 현재 평면은 없다
        if (!paired && !tried) continue;
        if (paired) {
            out.images.push(before, after);
            out.labels.push(`${nameOf(k)} 평면 — 이전`, `${nameOf(k)} 평면 — 현재`);
        }
        if (tried) {
            out.images.push(tried);
            out.labels.push(`${nameOf(k)} 평면 — ${TRIAL_PLAN_LABEL}`);
        }
        out.info.push({
            층: nameOf(k), 같은_높이의_레벨: namesOf(k), 역할: "변경 층", 변경_요소_수: count.get(k) || 0,
            ...(tried ? { 만들고_지운_요소_수: ids.length } : {}),
        });
        out.levels.push({ key: k, name: nameOf(k), role: "변경 층", before: paired ? before : null, after: paired ? after : null, trial: tried || null });
    }

    if (vertical && changed.length) {
        const i = levels.findIndex((l) => l.key === changed[0]);
        for (const n of [levels[i - 1], levels[i + 1]]) {
            if (!n || changed.includes(n.key)) continue;
            const [img] = captureLevelPlans({ levelKey: n.key, shots: [{ index: toIndex, tint: afterTint }] });
            if (!img) continue;
            out.images.push(img);
            out.labels.push(`${n.name} 평면 — 현재 (인접 층)`);
            out.info.push({ 층: n.name, 같은_높이의_레벨: n.names, 역할: n === levels[i - 1] ? "아래 층" : "위 층" });
            out.levels.push({ key: n.key, name: n.name, role: n === levels[i - 1] ? "아래 층" : "위 층", before: null, after: img, trial: null });
        }
    }
    return out;
}

const PLAN_NOTE = "평면은 층 바닥에서 층고의 40% 높이로 수평으로 잘라 위에서 본 그림입니다(북쪽이 위). 이전·현재 평면은 같은 축척·같은 틀입니다. "
    + "이전 평면의 빨강 = 삭제될 요소, 주황 = 수정 전 요소 / 현재 평면의 초록 = 추가된 요소, 주황 = 수정 후 요소. "
    + "평면의 층은 실제 높이로 묶은 것이라, '층_카테고리별_변화'의 층 이름(로그의 레벨)과 다를 수 있습니다.";
// 만들고 지운 요소 평면이 있을 때만 덧붙인다
const PLAN_NOTE_TRIAL = ` '${TRIAL_PLAN_LABEL}' 평면은 구간 안에서 만들었다가 지운 요소(구간 양 끝 어디에도 없어 이전·현재 평면에는 나오지 않는 요소)를 `
    + "지워지기 직전 모습으로 보라색으로 그린 것입니다. 회색은 현재 시점의 배치이고 위치를 가늠하는 바탕일 뿐입니다. "
    + "그 요소가 다 들어오도록 틀을 따로 잡아 이전·현재 평면과 축척이 다를 수 있으니, 위치는 회색 바탕에 견줘 읽으세요. "
    + "이 평면으로 그 요소가 어디에 놓였었는지 읽으세요. 만들었다가 지운 요소가 모두 버린 대안인 것은 아닙니다(잘못 넣은 것을 바로잡았거나 잠깐 쓴 보조 요소일 수 있습니다). "
    + "구간 전체의 수는 '구간_내부_과정'에 있고, '평면_층'의 '만들고_지운_요소_수'는 그 가운데 이 평면에 그려진 수입니다. "
    + "나머지는 지붕·천장처럼 평면에서 빼는 요소이거나, 자르는 높이에 걸리지 않거나, 지워지기 직전에 건물에서 멀리 떨어져 있던 요소여서 그리지 않았습니다.";

// ── 지시문의 공통 규칙 ──────────────────────────────────────────────────────
// 수정이 아닌 두 갱신 분류를 이름으로 부르게 한다(수정으로 세지 않게)
const RULE_UPDATES = "'수정'은 구간 양 끝을 비교해 입력 값이 달라진 요소만 센 것입니다. '수정이_아닌_갱신'의 '결과값만 변경'(면적 · 체적처럼 계산되는 값만 달라진 요소)과 '함께 갱신'(기록된 값에 차이가 없는 갱신)은 그 이름으로 따로 적고, 수정으로 세지 마세요.";
// 숫자마다 계산 항목의 키를 함께 내게 한다 — 숫자 검사가 낱말이 아니라 키로 대조한다(numberCheck.js)
const RULE_KEYS = "데이터의 숫자에는 바로 뒤에 [#k12] 같은 키가 붙어 있습니다. 답변에 데이터의 숫자를 쓸 때마다 그 숫자 바로 뒤에 그 숫자의 키를 그대로 옮겨 붙이고, 단위와 조사는 키 뒤에 쓰세요"
    + "(예: 벽 12[#k7]개 추가, 높이 3,000[#k31] mm). 타입 이름이나 예시 문장 속 숫자도 같습니다. 키는 화면에서 지워지고, 숫자를 계산된 값과 하나씩 대조하는 데만 쓰입니다. "
    + "다른 숫자의 키를 붙이거나 키를 지어내지 말고, 데이터에 없는 숫자에는 키를 붙이지 마세요.";
// 순서는 단계를, 수치는 요소를 센다
const RULE_SEQUENCE ="'변경_순서'는 설계자 자신의 단계(추가 · 삭제 · 입력 값 변경)만 시간 순서로 묶은 것이고, 그 수는 요소 수가 아니라 단계 수입니다. 같은 종류 · 카테고리라도 '층_카테고리별_변화'의 요소 수와 다를 수 있습니다(벽 12개를 옮겼다 되돌리면 순서에서는 24단계, 수정된 요소는 0). '전파_가능'은 호스트(문 · 창이 붙은 벽 등)가 같은 순간 바뀌거나 지워져 함께 바뀌었을 수 있는 단계 수이니, 그 단계를 설계자가 직접 한 것으로 단정하지 마세요.";

// ── 결과 형식: 관찰된 변경 · 공간적 영향 · 추론된 설계 의사결정 ────────────────
// check 는 그 항목의 문장을 어떻게 확인하는지 알리는 꼬리표다(제목 옆에 보인다): 숫자는 계산값과 대조하고,
// 공간 서술은 평면에 견줘 읽고, 추론은 가설로 읽는다. 항목이 꼬리표를 정한다 — 문장마다 따로 판정하지 않는다.
export const DECISION_SECTIONS = [
    { key: "obs", tone: "tone-accent", title: "Observed Change", re: /관찰된\s*변경|Observed\s*Change/i,
        check: "숫자 검사", checkTip: "이 항목의 숫자는 계산된 값과 대조해요. 숫자가 아닌 말은 대조하지 않아요." },
    { key: "spa", tone: "tone-spa", title: "Spatial Impact", re: /공간적\s*영향|Spatial\s*Impact/i,
        check: "평면과 대조해 읽기", checkTip: "AI 가 평면을 읽고 쓴 서술이에요. AI 에 보낸 평면과 견줘 확인하세요." },
    { key: "inf", tone: "tone-pin", title: "Inferred Design Decision", re: /추론된\s*설계\s*의사\s*결정|Inferred\s*Design\s*Decision/i,
        check: "가설", checkTip: "AI 의 추론이에요. 적힌 근거와 함께 가설로 읽고, 중요한 것은 설계자에게 확인하세요." },
];

/**
 * 모든 요약이 함께 쓰는 분석 순서와 출력 형식.
 * @param {object} o
 * @param {string} o.relation  ② 단계에서 볼 재료(예: "'변경_순서'")
 * @param {string} o.observed  관찰된 변경에 덧붙일 말
 * @param {string} o.spatial   공간적 영향에 덧붙일 말
 * @param {string} o.inferred  추론된 설계 의사결정에 덧붙일 말
 * @param {string} [o.length]  분량 제한
 */
function decisionFormat({ relation, observed, spatial, inferred, length = "" }) {
    const [obs, spa, inf] = DECISION_SECTIONS.map((s) => s.title);
    return [
        `분석은 이 순서로 하세요: ① 로그 · 수치 · 이미지에서 직접 확인되는 변경 사실을 찾고 → ② 변경들이 어떤 순서와 관계로 일어났는지 ${relation}로 묶고 → ③ 변경 전후를 비교해 주변 공간과 공간 구성에 준 영향을 파악한 뒤 → ④ 그 흐름이 어떤 설계 의사결정일 수 있는지 해석하세요.`,
        `한국어로, 아래 세 항목만 제목을 그대로 써서 작성하세요. 강조는 **굵게**만 사용하세요. 각 항목은 한두 문장의 도입 뒤에 '- '로 시작하는 글머리로 나눠 쓰고, 글머리 사이에 빈 줄을 넣지 마세요. 글머리 하나는 한 줄로 끝내세요.${length ? ` ${length}` : ""}`,
        RULE_KEYS,
        "",
        `**${obs}** — 직접 확인되는 사실만 쓰고 해석이나 의도는 섞지 마세요. 개별 변경을 나열하지 말고 관련된 변경끼리 묶어서 쓰세요. ${observed}`,
        `**${spa}** — 변경 때문에 생긴 공간적 · 정량적 영향. ${spatial}`,
        `**${inf}** — 앞의 두 항목만 근거로 한 해석입니다. 물량을 다시 요약하지 말고, 변경이 공간에 어떤 의미인지 추정하세요. `
            + "크기 · 위치 · 문과 창 · 가구 · 계단으로 그 공간이 무엇(방 · 거실 · 부엌 · 욕실 · 현관 · 계단실 · 발코니 등)일 가능성이 큰지, "
            + "그리고 설계자가 왜 그렇게 바꿨을지 설계 관점(동선 · 채광 · 조망 · 프라이버시 · 단열 · 구조 · 층고 등)으로 추정하세요. "
            + "예: 외벽 타입이 얇은 것으로 바뀌었다면 단열 성능을 다시 검토했을 수 있고, 한쪽 실이 넓어지고 창이 더해졌다면 그 실을 주된 거실이나 침실로 정했을 수 있다. "
            + "해석은 짧게 끝내지 말고, 공적 영역과 사적 영역의 구분, 생활 동선과 진입, 채광과 조망, 층 사이의 관계, 다음 설계 단계에 줄 영향까지 설계자의 입장에서 넓게 풀어 쓰세요. 다만 숫자와 관찰 사실은 입력에 있는 것만 쓰고, 추정은 추정이라고 밝히세요. "
            + "해석 항목마다 설계자가 고른 대안이 무엇인지 적고, 변경 순서에 버린 대안이 보이면(만들었다 지운 것, 바꿨다 되돌린 것, 고쳐서 바꾼 것 등) 그것도 함께 적은 뒤, 왜 그렇게 했을지 이유를 적으세요. 만들었다 지운 요소나 바꿨다 되돌린 요소가 모두 버린 대안인 것은 아니니(잘못 넣은 것을 바로잡았거나 잠깐 쓴 보조 요소일 수 있습니다), 순서와 평면이 뒷받침할 때만 버린 대안으로 적으세요. 버린 대안이 순서에 보이지 않으면 지어내지 마세요. "
            + `추정은 '~로 보인다', '~일 수 있다'로 쓰고, 해석마다 끝에 '(근거: 어떤 관찰 · 영향 · 확신 높음/중간/낮음)'을 붙이세요. 여러 해석이 가능하면 함께 쓰고, 근거가 부족하면 부족하다고 쓰세요. ${inferred}`,
    ].join("\n");
}

/**
 * 세 항목 형식의 요약을 항목별 칸으로 나눠 그린다(사실 · 영향 · AI 추론 표시).
 * 형식이 아니면(예전 요약) 그대로 돌려준다. safeHtml · 검산을 거친 HTML 에 적용하며,
 * 여기서 붙이는 태그는 화면용이라 저장하지 않는다.
 */
export function sectionize(html) {
    const hits = [];
    for (const m of String(html || "").matchAll(/<strong>([^<]*)<\/strong>/g)) {
        const sec = DECISION_SECTIONS.find((s) => s.re.test(m[1]));
        if (sec && !hits.some((h) => h.sec === sec)) hits.push({ sec, title: m[1], start: m.index, end: m.index + m[0].length });
    }
    if (hits.length < 2) return html;
    const trim = (t) => t.replace(/^(?:\s|<br>)*(?:[—–:-]\s*)?(?:<br>)*/, "").replace(/(?:\s|<br>)+$/, "");
    const lead = trim(html.slice(0, hits[0].start));
    return (lead ? `<div class="aisec__lead">${blockify(lead)}</div>` : "") + hits.map((h, i) => `
        <section class="aisec aisec--${h.sec.key} ${h.sec.tone}">
            <div class="aisec__head"><span class="aisec__tag tag">${h.sec.title}</span><span class="aisec__check" title="${h.sec.checkTip}">${h.sec.check}</span></div>
            <div class="aisec__body">${blockify(trim(html.slice(h.end, hits[i + 1]?.start ?? html.length)))}</div>
        </section>`).join("");
}

/**
 * 항목 본문의 줄(<br>)을 문단과 글머리로 다시 묶는다. 모델이 글머리 사이에 빈 줄을 넣거나
 * 안 넣거나, '-' · '•' · '–' 중 무엇을 쓰든 화면에서는 같은 간격 · 같은 점으로 보이게 한다.
 * 글머리 뒤에 이어지는 들여쓴 줄은 그 글머리의 계속으로 본다. 글자는 바꾸지 않고 포장만 한다.
 */
export function blockify(html) {
    const lines = String(html || "").split(/\s*<br>\s*/);
    const BULLET = /^(?:[-•–·*]|\d+[.)])\s+/;
    const out = [];
    let list = null, para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${para.join(" ")}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<ul class="aisec__list">${list.map((li) => `<li>${li}</li>`).join("")}</ul>`); list = null; } };
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) { flushPara(); continue; }           // 빈 줄은 문단 경계일 뿐, 목록은 끊지 않는다
        if (BULLET.test(line)) { flushPara(); (list ||= []).push(line.replace(BULLET, "")); continue; }
        if (list && /^\s/.test(raw)) { list[list.length - 1] += " " + line; continue; }   // 들여쓴 계속 줄
        flushList(); para.push(line);
    }
    flushPara(); flushList();
    return out.join("");
}

function pinSummary(pin) {
    if (!pin) return null;
    return { 제목: pin.title, 메모: pin.note || null, 단계: pin.stage || null };
}

function timeLabel(key) {
    const f = formatKey(key);
    return `${f.date} ${f.time}`;
}

// ── 요청 ─────────────────────────────────────────────────────────────────────
const SYSTEM_MESSAGE = "너는 BIM 설계 변경을 해석하는 조수다. 수치는 주어진 값만 쓰고 직접 계산하지 않는다. 데이터의 숫자를 쓸 때는 그 숫자에 붙은 키를 함께 옮긴다. 관찰한 사실과 추론을 섞지 않고, 추론에는 근거와 확신 정도를 밝힌다.";
const TEMPERATURE = 0.2;
const IMAGE_DETAIL = "low";

/**
 * 데이터는 숫자마다 키를 붙인 사본으로 보낸다(numberCheck.keyContext) — 키의 번호는 collectFacts(context) 의 순서와 같다.
 * @returns {{ text: string, settings: object }}
 *   text = 답변 그대로(숫자 뒤에 키가 붙어 있다 — 화면에 쓸 때는 stripKeys, 숫자 검사에는 그대로)
 *   settings = 실제로 받아들여진 요청의 모델 설정(모델 이름 · 요청 매개변수) — 서술과 함께 저장한다
 */
async function ask(apiKey, instructions, context, images) {
    const content = [{ type: "text", text: `${instructions}\n\n데이터: ${JSON.stringify(keyContext(context).data)}` }];
    for (const url of images) {
        if (url) content.push({ type: "image_url", image_url: { url, detail: IMAGE_DETAIL } });
    }
    const model = getModel();
    const messages = [
        { role: "system", content: SYSTEM_MESSAGE },
        { role: "user", content },
    ];

    // 추론 계열 모델은 temperature 를 받지 않는다 → 거절당하면 빼고 한 번 더
    let temperature = TEMPERATURE;
    let res = await send({ model, messages, temperature });
    if (!res.ok && res.status === 400) {
        const text = await res.clone().text();
        if (/temperature|unsupported_value|unsupported_parameter/i.test(text)) {
            temperature = null;
            res = await send({ model, messages });
        }
    }

    if (!res.ok) {
        const text = await res.text();
        if (res.status === 401) throw new Error("API 키가 올바르지 않아요.");
        if (/model_not_found|does not exist|do not have access/i.test(text)) {
            throw new Error(`이 계정에서 "${model}" 을(를) 쓸 수 없어요. [목록]으로 사용 가능한 모델을 확인하세요.`);
        }
        if (/image|vision|multimodal/i.test(text)) {
            throw new Error(`"${model}" 은(는) 이미지를 읽지 못하는 것 같아요. 이미지를 읽는 모델을 골라주세요.`);
        }
        throw new Error(`요청 실패 (${res.status}) ${text.slice(0, 140)}`);
    }
    const data = await res.json();
    return {
        text: data?.choices?.[0]?.message?.content?.trim() || "",
        settings: {
            엔드포인트: ENDPOINT,
            모델: model,
            응답이_밝힌_모델: typeof data?.model === "string" ? data.model : null,
            매개변수: { temperature, 이미지_detail: IMAGE_DETAIL },   // temperature null = 모델이 받지 않아 빼고 보냄
            이미지_수: images.filter(Boolean).length,
            시스템_메시지: SYSTEM_MESSAGE,
        },
    };

    function send(body) {
        return fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
        });
    }
}

export function renderMarkdown(text) {
    return escapeHtml(text)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
}

/**
 * 답변을 저장할 두 벌로 — html 은 키를 지운 글(화면 · 보고서 · 평가가 읽는다), keyed 는 키가 붙은 글(숫자 검사가 읽는다).
 * 답변에 키가 하나도 없으면 keyed 는 두지 않는다.
 */
function answerHtml(text) {
    const answer = text || "요약을 받지 못했어요.";
    const html = renderMarkdown(stripKeys(answer));
    const keyed = renderMarkdown(answer);
    return keyed === html ? { html } : { html, keyed };
}

// ─────────────────────────────────────────────────────────────────────────────
// 0) 녹음: 전사 → 말한 의도와 실제 변경 대조
// ─────────────────────────────────────────────────────────────────────────────
export function getTranscribeModel() {
    try { return (localStorage.getItem(TRANSCRIBE_STORAGE) || "").trim() || DEFAULT_TRANSCRIBE; } catch { return DEFAULT_TRANSCRIBE; }
}
export function setTranscribeModel(value) {
    const v = (value || "").trim();
    if (!v) return;
    try { localStorage.setItem(TRANSCRIBE_STORAGE, v); } catch { }
}

function transcriptCache() {
    try { return JSON.parse(localStorage.getItem(TRANSCRIPT_STORAGE) || "{}"); } catch { return {}; }
}
export function getTranscript(rec) {
    return transcriptCache()[rec?.name] || null;
}
function saveTranscript(rec, text) {
    const all = transcriptCache();
    all[rec.name] = text;
    try { localStorage.setItem(TRANSCRIPT_STORAGE, JSON.stringify(all)); } catch { }
}

/** 녹음 파일을 글로 옮긴다. 한 번 옮긴 결과는 브라우저에 저장해 다시 보내지 않는다. */
export async function transcribeRecording(rec, { force = false } = {}) {
    const cached = getTranscript(rec);
    if (cached && !force) return cached;

    const apiKey = getKey();
    if (!apiKey) throw new Error("API 키가 필요해요.");

    const blob = await (await fetch(rec.url)).blob();
    const form = new FormData();
    form.append("file", new File([blob], rec.name || "recording.wav", { type: blob.type || "audio/wav" }));
    form.append("model", getTranscribeModel());

    const res = await fetch(TRANSCRIBE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });
    if (!res.ok) {
        const text = await res.text();
        if (res.status === 401) throw new Error("API 키가 올바르지 않아요.");
        if (/model_not_found|does not exist|do not have access/i.test(text)) {
            throw new Error(`이 계정에서 "${getTranscribeModel()}" 로 전사할 수 없어요. 다른 전사 모델을 골라주세요.`);
        }
        throw new Error(`전사 실패 (${res.status}) ${text.slice(0, 140)}`);
    }
    const data = await res.json();
    const text = (data?.text || "").trim();
    if (!text) throw new Error("전사 결과가 비어 있어요.");
    saveTranscript(rec, text);
    return text;
}

/** 녹음 구간(시작~종료)에 해당하는 타임라인 범위 */
function indexRangeFor(rec) {
    const ms = store.keyMs;
    const at = (t) => {
        if (!ms.length || !(t >= ms[0])) return 0;
        let lo = 0, hi = ms.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ms[mid] <= t) lo = mid; else hi = mid - 1; }
        return lo;
    };
    const from = at(rec.startMs);
    const to = Number.isFinite(rec.endMs) ? at(rec.endMs) : from;
    return { from, to: Math.max(from, to) };
}

/** 녹음에서 말한 내용과, 그 시간대에 실제로 바뀐 것을 대조해 요약한다. */
export async function summarizeRecording(rec) {
    const apiKey = getKey();
    if (!apiKey) throw new Error("API 키가 필요해요.");

    const transcript = await transcribeRecording(rec);
    const { from, to } = indexRangeFor(rec);
    const diff = diffBetween(from, to);
    const fromKey = store.timeKeys[from];
    const toKey = store.timeKeys[to];
    const pins = store.pins
        .filter((p) => p.ms >= rec.startMs - 60000 && p.ms <= (rec.endMs || rec.startMs) + 60000)
        .map(pinSummary);

    const context = {
        녹음: {
            이름: rec.displayName || rec.name,
            시작: timeLabel(fromKey),
            종료: timeLabel(toKey),
            길이_초: Number.isFinite(rec.durationSec) ? Math.round(rec.durationSec) : null,
            전사: transcript.slice(0, 6000),
        },
        같은_시간대_변경: {
            요소_수: {
                추가: diff.addedIds.length,
                삭제: diff.deletedIds.length,
                수정: diff.modified.after.length,
            },
            수정이_아닌_갱신: updatesContext(diff),
            층_카테고리별: levelRows(diff),
            물량_변화: quantityDeltas(fromKey, toKey),
            수정_내용: modsContext(diff),
            변경_순서: changeSequence(from, to),
            변경_요소_예시: {
                추가: sampleElements(diff.addedIds),
                삭제: sampleElements(diff.deletedIds),
                수정: sampleElements(diff.modified.after),
            },
        },
        같은_시간대_핀: pins,
    };

    const instructions = [
        "아래는 BIM 모델링 중 녹음한 말(전사)과, 그 시간대에 실제로 바뀐 모델 변화입니다.",
        "숫자는 이미 계산된 값입니다. 그대로 인용하고, 직접 계산하거나 없는 수치를 지어내지 마세요.",
        "전사에는 잡담이나 잘못 들린 부분이 섞일 수 있습니다. 설계와 무관한 내용은 빼세요.",
        "전사는 설계자의 말이지 모델의 사실이 아닙니다. 관찰된 변경에는 모델 변화만 쓰고, 말한 내용은 추론의 근거로만 쓰세요.",
        RULE_UPDATES,
        RULE_SEQUENCE,
        "",
        decisionFormat({
            relation: "'변경_순서'(시간 순)와 말한 순서",
            observed: "그 시간대에 실제로 바뀐 요소 수 · 층별 변화 · 수정 내용을 숫자와 함께 2~5줄.",
            spatial: "어느 층 어느 부분에 변경이 몰렸는지, 물량 증감과 함께 1~3줄.",
            inferred: "먼저 녹음에서 무엇을 하려 했는지 2~3문장으로 요약하고, 말한 대로 반영된 것 / 말했지만 모델에 없는 것 / 말하지 않았는데 바뀐 것을 짚은 뒤, 그 흐름이 어떤 설계 의사결정인지 해석하세요. 녹음에서 언급된 할 일이나 미정 사항이 있으면 마지막에 '남은 일:' 뒤에 목록으로 쓰세요.",
        }),
    ].join("\n");

    const { text } = await ask(apiKey, instructions, context, []);
    // html 은 키를 지운 글, keyed 는 키가 붙은 글(있을 때만) — 숫자 검사에 keyed 를 넘기면 키로 대조한다
    return { ...answerHtml(text), transcript, facts: collectFacts(context) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) 핀 카드: 이전 핀 대비 요약 (남 · 동 · 북 · 서 · 상부 + 이전 핀 정면)
//    요약은 핀에 붙어 저장되어, 나중에 다시 열어도 그대로 남는다.
// ─────────────────────────────────────────────────────────────────────────────
const PIN_SUMMARY_STORAGE = "abl_pin_summaries";
const EMPTY_START_LABEL = "기록 시작 전 (빈 모델)";

function pinSummaryStore() {
    try { return JSON.parse(localStorage.getItem(PIN_SUMMARY_STORAGE) || "{}"); } catch { return {}; }
}
export function getPinSummary(pinId) {
    return pinSummaryStore()[pinId] || null;
}
function savePinSummary(pinId, data) {
    const all = pinSummaryStore();
    all[pinId] = data;
    try { localStorage.setItem(PIN_SUMMARY_STORAGE, JSON.stringify(all)); } catch { }
}
export function clearPinSummary(pinId) {
    const all = pinSummaryStore();
    delete all[pinId];
    try { localStorage.setItem(PIN_SUMMARY_STORAGE, JSON.stringify(all)); } catch { }
}

/**
 * 경로 수치 — 구간 끝 비교(순변화)에는 보이지 않는 구간 안의 과정. 압축하기 전의 전체 순서에서 센다(segment.js).
 *   생성 후 삭제(만들고 지움)       구간 시작에 없고, 구간 안에서 추가되고, 구간 끝에 없는 요소
 *   변경 후 되돌림(바꿨다 되돌림)   양 끝에 있고 순 단계에 차이가 없으며, 중간에 설계자 자신의 단계가 있는 요소
 *   추가 후 다시 수정(추가 뒤 고침) 구간 시작에 없고 끝에 있으며, 마지막으로 추가된 뒤 입력 값 변경이 있었던 요소
 * 층_카테고리별 은 셋을 층 × 카테고리로 나눈 것이다(칸의 합 = 구간 전체 수). 층은 '층_카테고리별_변화'와 같은
 * 로그의 레벨이고, 만들고 지운 요소는 지워지기 전 마지막 버전의 레벨 · 카테고리로 센다.
 */
export function segmentProcess(fromIndex, toIndex) {
    const { path, pathRows } = segmentAccount(fromIndex, toIndex);
    return {
        생성_후_삭제된_객체: path.createdRemoved,
        변경_후_되돌린_객체: path.restored,
        추가_후_다시_수정된_객체: path.addedRevised,
        층_카테고리별: pathRows.map((r) => ({
            층: r.lv,
            카테고리: r.cat,
            생성_후_삭제된_객체: r.createdRemoved,
            변경_후_되돌린_객체: r.restored,
            추가_후_다시_수정된_객체: r.addedRevised,
        })),
    };
}

/**
 * 모델 범위 밖에서 만들고 지운 요소(segment.js 의 outside) — 구간의 계산에서 뺐고 AI 에는 보내지 않는다(수도 보내지 않는다).
 * 저장하는 근거에만 그 수를 남긴다 — 무엇을 세지 않았는지 나중에 확인할 수 있게. 없으면 칸을 만들지 않는다.
 * 숫자 검산의 사실(facts)은 AI 에 보낸 데이터에서만 뽑으므로 이 수는 검산의 기준이 되지 않는다.
 */
function outsideEvidence(fromIndex, toIndex) {
    const out = segmentAccount(fromIndex, toIndex).outside;
    return out?.elements ? { 세지_않은_범위_밖_요소: { 요소_수: out.elements, 자신의_단계_수: out.steps } } : {};
}

/** 수정이 아닌 두 갱신 분류 — 구간 전체 수(층 × 카테고리로 나누지 않는다) */
function updatesContext(diff) {
    return {
        결과값만_바뀐_요소: diff.derivedOnly?.after.length ?? 0,
        함께_갱신된_요소: diff.incidental?.after.length ?? 0,
    };
}

// ── 녹음 전사를 AI 해석에 보낼지 ─────────────────────────────────────────────
// 기본은 보내지 않는다 — Commit Message(핀 제목 · 메모 · 단계)가 서술에 들어가는 유일한 설계자 설명이다.
// 실험 기능(?lab=1)에서만 켤 수 있고, 켜 둔 채로 평소 화면을 열어도 보내지 않는다.
export function getSendTranscripts() {
    if (!LAB) return false;
    try { return localStorage.getItem(SEND_TRANSCRIPT_STORAGE) === "1"; } catch { return false; }
}
export function setSendTranscripts(on) {
    try {
        if (on) localStorage.setItem(SEND_TRANSCRIPT_STORAGE, "1");
        else localStorage.removeItem(SEND_TRANSCRIPT_STORAGE);
    } catch { }
}

/**
 * 핀 요약에 보내는 입력 전부(지시문 · 데이터 · 이미지)를 만든다. 요청은 보내지 않는다.
 * Commit 해석 화면이 AI 에 보낸 것과 똑같은 이미지 · 데이터를 보여줄 때도 쓴다.
 */
export function buildPinInput(pin) {
    const { prev, from: fromIndex } = pinRange(pin);
    const fromKey = fromIndex < 0 ? null : store.timeKeys[fromIndex];   // 첫 구간은 빈 모델에서 시작한다
    const toKey = store.timeKeys[pin.index];
    const account = segmentAccount(fromIndex, pin.index);
    const diff = account.diff;

    // 추가는 초록, 수정은 주황으로 칠해서 찍는다(삭제는 이 시점에 없으므로 보이지 않는다)
    // 수정은 순 단계가 입력 값 변경인 요소만 — 결과값만 변경 · 함께 갱신은 칠하지 않는다
    const tint = new Map();
    for (const id of diff.addedIds) tint.set(id, new Color(ADDED));
    for (const id of diff.modified.after) tint.set(id, new Color(MODIFIED));

    const views = captureViews({ index: pin.index, dirs: VIEWS.map((v) => v.dir), tint });
    const beforeShot = captureViews({ index: fromIndex, dirs: [VIEWS[0].dir] });
    // 바뀐 층의 평면 — 구간 안에서 만들고 지운 요소(양 끝에 없는 요소)도 그 층에 있으면 한 장 더 그린다
    const plans = planShots(fromIndex, pin.index, diff, account.pathVersions.createdRemoved);
    const hasTrialPlan = plans.levels.some((l) => l.trial);
    const images = [...views, ...beforeShot, ...plans.images];
    const imageLabels = [...VIEWS.map((v) => `현재 시점 ${v.label}`), fromIndex < 0 ? "이전 시점 남측(정면) — 빈 모델" : "이전 시점 남측(정면)", ...plans.labels];
    const recordings = getSendTranscripts() ? segmentRecordings(fromKey, toKey) : null;

    const context = {
        시점: {
            이전: { 시각: fromIndex < 0 ? EMPTY_START_LABEL : timeLabel(fromKey), 핀: pinSummary(prev) },
            현재: { 시각: timeLabel(toKey), 핀: pinSummary(pin) },
        },
        변경_요소_수: {
            추가: diff.addedIds.length,
            삭제: diff.deletedIds.length,
            수정: diff.modified.after.length,
            유지: diff.unchangedIds.length,
        },
        수정이_아닌_갱신: updatesContext(diff),
        층_카테고리별_변화: levelRows(diff),
        물량_변화: quantityDeltas(fromKey, toKey),
        수정_내용: modsContext(diff),
        변경_요소_예시: {
            추가: sampleElements(diff.addedIds),
            삭제: sampleElements(diff.deletedIds),
            수정: sampleElements(diff.modified.after),
        },
        변경_순서: changeSequence(fromIndex, pin.index),
        구간_내부_과정: segmentProcess(fromIndex, pin.index),
        이미지_설명: {
            순서: imageLabels,
            색: "3D 이미지: 초록 = 이전 대비 추가된 요소, 주황 = 수정된 요소. 삭제된 요소는 현재 시점에 없으므로 보이지 않음.",
            방위: "Revit 프로젝트 북 기준",
            ...(plans.images.length ? { 평면: PLAN_NOTE + (hasTrialPlan ? PLAN_NOTE_TRIAL : ""), 평면_층: plans.info } : {}),
        },
        ...(recordings ? { 구간_녹음: recordings } : {}),
    };

    const instructions = [
        "아래는 BIM 모델에서 이전 핀 시점과 현재 핀 시점 사이의 변경입니다. 핀은 설계자가 '여기까지 한 단위의 작업'이라고 표시한 지점(Design Commit)이고, 핀 제목·메모는 설계자가 남긴 짧은 설명(Commit Message)입니다. 계산된 사실이 아니라 설계자가 쓴 말입니다.",
        "숫자(물량·개수·층별 변화)는 이미 계산된 값입니다. 그대로 인용하고, 직접 계산하거나 없는 수치를 지어내지 마세요.",
        `이미지는 순서대로 ${imageLabels.join(", ")} 입니다.`,
        "이미지는 형태·배치·공간 관계를 읽는 데만 쓰고, 이미지에서 수량을 세지 마세요.",
        RULE_UPDATES,
        RULE_SEQUENCE,
        "",
        decisionFormat({
            relation: "'변경_순서'(시간 순)",
            observed: "추가·삭제·수정 요소 수, 층별 변화, '수정_내용'의 항목과 예시 문장, 변경의 순서, '구간_내부_과정'(구간 안에서 생성 후 삭제된 객체, 변경 후 되돌린 객체, 추가 후 다시 수정된 객체. 그 안의 '층_카테고리별'은 그것이 어느 층의 어느 카테고리에서 있었는지입니다)을 숫자와 함께 3~6줄.",
            spatial: (plans.images.length
                ? "이전·현재 평면을 비교해 어느 층 어느 쪽(방위)에서 실 구획·통로·개구부(문·창) 배치가 어떻게 달라졌는지, 어느 실이 생기거나 넓어지거나 좁아졌는지 물량 증감과 함께 2~4줄. 인접 층 평면이 있으면 층 사이 관계(계단·기둥·수직 정렬)도 보세요."
                : "어느 층 어느 쪽(방위)에서 형태·배치가 어떻게 달라졌는지, 물량 증감과 함께 2~4줄.")
                + (hasTrialPlan ? ` '${TRIAL_PLAN_LABEL}' 평면이 있으면 만들었다가 지운 요소가 어느 쪽에 놓였었는지도 한 줄로 쓰세요.` : ""),
            inferred: `핀 제목·메모${recordings ? "나 녹음에서 말한 내용" : ""}이 있으면 해석과 대조해 맞는지 밝히고, 메모에 없는 변경은 분명히 짚으세요. 해석은 3~5개, 각각 2~3문장.`
                + (hasTrialPlan ? ` 버린 대안의 위치는 '${TRIAL_PLAN_LABEL}' 평면에 보이는 만큼만 말하세요.` : ""),
        }),
    ].join("\n");

    return { prev, fromIndex, toIndex: pin.index, fromKey, toKey, diff, account, views, beforeShot, plans, images, imageLabels, context, instructions };
}

export async function summarizePin(pin) {
    const apiKey = getKey();
    if (!apiKey) throw new Error("API 키가 필요해요.");
    const { fromIndex, fromKey, toKey, images, imageLabels, context, instructions } = buildPinInput(pin);

    const { text, settings } = await ask(apiKey, instructions, context, images);
    const answer = answerHtml(text);
    const html = answer.html;
    savePinSummary(pin.id, {
        ...answer,   // html(키를 지운 글) + keyed(키가 붙은 글, 숫자 검사용)
        model: getModel(),
        at: Date.now(),
        from: fromIndex,
        to: pin.index,
        // 검산용 숫자 사실(AI 에게 보낸 데이터 전부에서) — 그릴 때마다 요약 글과 대조한다
        facts: collectFacts(context),
        // 지시문 전문과 모델 설정(모델 이름 · 요청 매개변수) — 서술이 어떻게 만들어졌는지 서술과 함께 남긴다
        prompt: { 지시문: instructions, ...settings },
        // 근거 — 요약이 무엇을 보고 쓰였는지 나중에 확인할 수 있게 함께 남긴다(이미지는 크기 때문에 개수만)
        evidence: {
            구간: { 이전: fromIndex < 0 ? EMPTY_START_LABEL : timeLabel(fromKey), 현재: timeLabel(toKey) },
            변경_요소_수: context.변경_요소_수,
            수정이_아닌_갱신: context.수정이_아닌_갱신,
            층_카테고리별_변화: context.층_카테고리별_변화,
            물량_변화: context.물량_변화,
            수정_내용: context.수정_내용,
            변경_순서: context.변경_순서,
            구간_내부_과정: context.구간_내부_과정,
            ...outsideEvidence(fromIndex, pin.index),   // AI 에 보낸 데이터가 아니다 — 세지 않은 수의 기록
            보낸_이미지: imageLabels,
            구간_녹음: (context.구간_녹음 || []).map((r) => ({ 이름: r.이름, 전사됨: Boolean(r.전사) })),
        },
    });
    return html;
}

/**
 * 저장된 요약의 숫자 검산 — 키가 붙은 글이 있으면 그것으로(키로 대조), 없으면 키 없는 글로(낱말로 대조).
 * 돌려주는 html 에는 키가 없다. 예전 요약(사실 없이 저장)은 근거 표로 대신한다.
 */
function checkSaved(saved) {
    return checkNumbers(safeHtml(saved.keyed || saved.html), saved.facts);
}

/** 검산 기능 전에 만든 요약 — 검산 줄 대신 한 줄 안내 */
function legacyCheckNote(saved) {
    return saved && !saved.facts
        ? `<p class="aiblk__legacy notice notice--plain notice--xs">${icon("alert", 12)}숫자 검산 기능 전에 만든 요약이에요. 다시 요약하면 숫자를 근거와 대조해요.</p>`
        : "";
}

/** 저장된 근거(와 지시문 · 모델 설정)를 사람이 읽을 수 있는 표로. */
function evidenceHtml(ev, prompt) {
    if (!ev) return "";
    const rows = (ev.층_카테고리별_변화 || []).slice(0, 24);
    const qty = (ev.물량_변화 || []).slice(0, 14);
    const c = ev.변경_요소_수 || {};
    return `
        <details class="aiblk__ev disc disc--rule disc--xs">
            <summary>${icon("chevronRight", 12)}근거 보기</summary>
            <div class="aiblk__ev-body">
                <p class="aiblk__ev-line"><b>구간</b> ${escapeHtml(ev.구간?.이전 || "")} → ${escapeHtml(ev.구간?.현재 || "")}
                    · 추가 ${c.추가 ?? 0} · 삭제 ${c.삭제 ?? 0} · 수정 ${c.수정 ?? 0}</p>
                ${rows.length ? `<table class="aiblk__ev-tb tbl tbl--xs"><thead><tr><th>층</th><th>카테고리</th><th>추가</th><th>삭제</th><th>수정</th></tr></thead><tbody>
                    ${rows.map((r) => `<tr><td>${escapeHtml(r.층)}</td><td>${escapeHtml(r.카테고리)}</td><td>${r.추가}</td><td>${r.삭제}</td><td>${r.수정}</td></tr>`).join("")}
                </tbody></table>` : ""}
                ${qty.length ? `<table class="aiblk__ev-tb tbl tbl--xs"><thead><tr><th>카테고리</th><th>지표</th><th>이전</th><th>현재</th><th>증감</th></tr></thead><tbody>
                    ${qty.map((q) => `<tr><td>${escapeHtml(q.카테고리)}</td><td>${escapeHtml(q.지표)}</td><td>${q.A}</td><td>${q.B}</td><td>${q.증감 > 0 ? "+" : ""}${q.증감}</td></tr>`).join("")}
                </tbody></table>` : ""}
                ${modsEvidenceHtml(ev.수정_내용)}
                ${updatesEvidenceHtml(ev)}
                ${sequenceEvidenceHtml(ev.변경_순서)}
                <p class="aiblk__ev-line"><b>보낸 이미지</b> ${(ev.보낸_이미지 || []).map(escapeHtml).join(" · ")}</p>
                ${(ev.구간_녹음 || []).length ? `<p class="aiblk__ev-line"><b>구간 녹음</b> ${ev.구간_녹음.map((r) => `${escapeHtml(r.이름)}${r.전사됨 ? " (전사 포함)" : " (전사 없음)"}`).join(" · ")}</p>` : ""}
                ${promptEvidenceHtml(prompt)}
            </div>
        </details>`;
}

/** AI 에게 넘기는 수정 내용(순 단계가 입력 값 변경인 요소) — 문장은 코드가 만든다 */
function modsContext(diff) {
    const m = summarizeModifications(diff, { exampleLimit: 14 });
    return {
        수정된_요소: m.changed,
        항목별_요소_수: m.groups.slice(0, 12).map((g) => ({ 항목: g.group, 요소_수: g.count })),
        예시: m.lines,
    };
}

function sequenceEvidenceHtml(seq) {
    const rows = sequenceRows(seq);
    if (!rows.length) return "";
    const skipped = seq.생략한_묶음_수 ?? seq.생략한_작은_단계 ?? 0;   // 뒤는 예전 요약의 근거
    const own = seq.자신의_단계_수;
    return `
        <p class="aiblk__ev-line"><b>변경 순서</b> ${rows.length}묶음${skipped ? ` (작은 묶음 ${skipped}개 생략)` : ""}${own
            ? ` · 설계자 자신의 단계 ${own.전체}${own.전파_가능 ? ` (전파 가능 ${own.전파_가능})` : ""}` : ""}</p>
        <ol class="aiblk__ev-list">${rows.map((r) => `<li><b>${escapeHtml(r.시각)}</b> ${r.줄.map(escapeHtml).join(" · ")}</li>`).join("")}</ol>`;
}

function modsEvidenceHtml(mods) {
    if (!mods || !mods.수정된_요소) return "";
    const groups = (mods.항목별_요소_수 || []).slice(0, 12);
    // 예전 요약은 새 버전이 생긴 요소를 모두 수정으로 세고 그 안을 나눠 적었다
    const head = mods.값이_바뀐_요소 != null
        ? `${mods.수정된_요소}개 중 값 변경 ${mods.값이_바뀐_요소} · 결과값만 ${mods.결과값만_바뀐_요소} · 함께 갱신 ${mods.함께_갱신된_요소}`
        : `${mods.수정된_요소}개 (구간 양 끝에서 입력 값이 달라진 요소)`;
    return `
        <p class="aiblk__ev-line"><b>수정</b> ${head}</p>
        ${groups.length ? `<table class="aiblk__ev-tb tbl tbl--xs"><thead><tr><th>수정 항목</th><th>요소 수</th></tr></thead><tbody>
            ${groups.map((g) => `<tr><td>${escapeHtml(g.항목)}</td><td>${g.요소_수}</td></tr>`).join("")}
        </tbody></table>` : ""}
        ${(mods.예시 || []).length ? `<ul class="aiblk__ev-list">${mods.예시.slice(0, 8).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}`;
}

/** 수정이 아닌 두 갱신 분류와 경로 수치(구간 전체 수 + 층 × 카테고리) */
function updatesEvidenceHtml(ev) {
    const u = ev.수정이_아닌_갱신, pr = ev.구간_내부_과정;
    const rows = (pr?.층_카테고리별 || []).slice(0, 24);   // 예전 요약의 근거에는 없다
    const out = ev.세지_않은_범위_밖_요소;                  // 있을 때만 저장된다(AI 에 보낸 데이터가 아니다)
    return (u ?`<p class="aiblk__ev-line"><b>수정이 아닌 갱신</b> 결과값만 변경 ${u.결과값만_바뀐_요소 ?? 0} · 함께 갱신 ${u.함께_갱신된_요소 ?? 0}</p>` : "")
        + (pr ? `<p class="aiblk__ev-line"><b>구간 안의 과정</b> 생성 후 삭제 ${pr.생성_후_삭제된_객체 ?? 0}${pr.변경_후_되돌린_객체 != null ? ` · 변경 후 되돌림 ${pr.변경_후_되돌린_객체}` : ""} · 추가 후 다시 수정 ${pr.추가_후_다시_수정된_객체 ?? 0}</p>` : "")
        + (rows.length ? `<table class="aiblk__ev-tb tbl tbl--xs"><thead><tr><th>층</th><th>카테고리</th><th>생성 후 삭제</th><th>변경 후 되돌림</th><th>추가 후 다시 수정</th></tr></thead><tbody>
            ${rows.map((r) => `<tr><td>${escapeHtml(r.층)}</td><td>${escapeHtml(r.카테고리)}</td><td>${r.생성_후_삭제된_객체}</td><td>${r.변경_후_되돌린_객체}</td><td>${r.추가_후_다시_수정된_객체}</td></tr>`).join("")}
        </tbody></table>` : "")
        + (out?.요소_수 ? `<p class="aiblk__ev-line"><b>세지 않은 것</b> 모델 범위 밖에서 만들고 지운 요소 ${out.요소_수}개 (자신의 단계 ${out.자신의_단계_수 ?? 0}) · AI 에 보내지 않음</p>` : "");
}

/** 서술과 함께 저장한 모델 설정과 지시문 전문 */
function promptEvidenceHtml(prompt) {
    if (!prompt) return "";
    const t = prompt.매개변수?.temperature;
    const bits = [
        prompt.모델,
        prompt.응답이_밝힌_모델 && prompt.응답이_밝힌_모델 !== prompt.모델 ? `응답 ${prompt.응답이_밝힌_모델}` : "",
        t == null ? "temperature 없이 보냄" : `temperature ${t}`,
        prompt.매개변수?.이미지_detail ? `이미지 detail ${prompt.매개변수.이미지_detail}` : "",
    ].filter(Boolean);
    return `
        <p class="aiblk__ev-line"><b>모델 설정</b> ${bits.map(escapeHtml).join(" · ")}</p>
        <details class="aiblk__ev-prompt disc disc--xs">
            <summary>${icon("chevronRight", 12)}지시문 보기</summary>
            <p class="aiblk__ev-pre">${escapeHtml(prompt.시스템_메시지 || "")}</p>
            <p class="aiblk__ev-pre">${escapeHtml(prompt.지시문 || "")}</p>
        </details>`;
}

/** 구간에 걸친 녹음. 이미 전사해 둔 것만 넣는다(음성을 새로 보내지 않는다). */
function segmentRecordings(fromKey, toKey) {
    const fromMs = fromKey == null ? -Infinity : keyMs(fromKey);   // 첫 구간은 기록 시작부터
    const toMs = keyMs(toKey);
    return store.recordings
        .filter((r) => r.startMs > fromMs && r.startMs <= toMs)
        .map((r) => ({
            이름: r.displayName || r.name,
            길이_초: Number.isFinite(r.durationSec) ? Math.round(r.durationSec) : null,
            전사: getTranscript(r)?.slice(0, 4000) || null,
        }));
}

function keyMs(key) {
    const i = store.timeKeys.indexOf(key);
    return i >= 0 ? store.keyMs[i] : NaN;
}

// ── 핀 요약 UI (이력 화면 · 핀 탭이 함께 쓴다) ──────────────────────────────
/**
 * 컨테이너 안에 핀 요약 블록을 그린다.
 * 저장된 요약이 있으면 바로 보여주고, 없으면 실행 버튼(또는 키 입력)을 보여준다.
 */
// 좁은 목록(핀 탭)에서 "전체 보기"로 펼친 핀 — 목록을 다시 그려도 펼친 상태를 유지한다
const expandedSummaries = new Set();

/** 사람 평가(정확 · 부분 · 오류) 자리 — 연구용 실험 기능이라 ?lab=1 에서만 붙인다 */
const rateSlot = () => (LAB ? `<div class="rate"></div>` : "");

export function mountPinSummary(container, pin, { autoRun = false, onChange, compact = false } = {}) {
    if (!container) return;
    container.dataset.pin = pin.id;
    const saved = getPinSummary(pin.id);
    const range = pinRange(pin);
    const opts = { onChange, compact };

    if (saved && !autoRun && compact && !expandedSummaries.has(pin.id)) {
        // 3단의 접힌 모습 — 요약 앞부분만 두세 줄, 근거·평가는 펼쳐야 보인다
        const stale = saved.from !== range.from || saved.to !== range.to;
        const rating = getRating("pin", pin.id);
        const verdict = VERDICTS.find((v) => v.id === rating?.verdict);
        const check = checkSaved(saved);
        paint(container, `
            <div class="aiblk__peek" data-ai-act="expand" role="button" tabindex="0" aria-expanded="false" title="펼쳐서 근거 · 평가까지 보기">
                <div class="aiblk__peek-head">
                    ${icon("sparkle", 12)}<b>AI 요약</b>
                    ${stale ? `<span class="aiblk__tag aiblk__tag--warn tag tone-mod" title="그 사이에 핀이 바뀌었어요">구간 바뀜</span>` : ""}
                    ${checkTagHtml(check.stats)}
                    ${verdict && LAB ? `<span class="aiblk__tag aiblk__tag--${verdict.id} tag ${VERDICT_TONE[verdict.id] || ""}">평가 · ${verdict.label}</span>` : ""}
                </div>
                    <span class="aiblk__chev">${icon("chevronDown", 12)}</span>
                </div>
                <div class="aiblk__body aiblk__body--clamp">${safeHtml(saved.html)}</div>
            </div>`);
        wire(container, pin, opts);
        return;
    }

    if (saved && !autoRun) {
        const stale = saved.from !== range.from || saved.to !== range.to;
        const check = checkSaved(saved);
        paint(container, `
            ${compact ? `<div class="aiblk__peek-head aiblk__peek-head--open" data-ai-act="fold" role="button" tabindex="0" aria-expanded="true" title="접기">
                ${icon("sparkle", 12)}<b>AI 요약</b>
                ${checkTagHtml(check.stats)}
                <span class="aiblk__chev ico--flip">${icon("chevronDown", 12)}</span>
            </div>` : ""}
            ${stale ? `<div class="aiblk__stale notice tone-mod">${icon("alert", 12)}그 사이에 핀이 바뀌었어요. 다시 요약하면 최신 구간으로 정리해요.</div>` : ""}
            <div class="aiblk__body">${sectionize(check.html)}</div>
            ${checkBarHtml(check.stats)}${legacyCheckNote(saved)}
            ${evidenceHtml(saved.evidence, saved.prompt)}
            ${rateSlot()}
            <div class="aiblk__foot">
                <span class="aiblk__model">${escapeHtml(saved.model || "")} · ${fmtWhen(saved.at)}</span>
                <button class="btn btn--ghost btn--xs" type="button" data-ai-act="again">${icon("refresh", 12)}다시 요약</button>
            </div>`);
        if (LAB) mountRating(container.querySelector(".rate"), {
            kind: "pin",
            id: pin.id,
            meta: {
                title: pin.title,
                timestamp: pin.ts,
                from: saved.from,
                to: saved.to,
                model: saved.model,
                summarizedAt: saved.at,
                summary: plainText(saved.html),
                check: check.stats,
            },
        });
        wireCheckToggle(container);
        wire(container, pin, opts);
        return;
    }

    if (!hasKey()) {
        paint(container, `
            <div class="aiblk__key">
                <span>OpenAI API 키를 입력하면 이 구간(이전 핀 → 이 핀)을 요약해요. 키는 이 브라우저에만 저장돼요.</span>
                <div class="aiblk__key-row field-row">
                    <input class="field field--sm" type="password" placeholder="sk-..." autocomplete="off" spellcheck="false" data-ai-key>
                    <button class="btn btn--sm btn--primary" type="button" data-ai-act="key">저장</button>
                </div>
            </div>`);
        wire(container, pin, opts);
        container.querySelector("[data-ai-key]")?.focus();
        return;
    }

    paint(container, `<div class="aiblk__loading busy"><span class="spinner"></span>5개 방향을 찍어 요약하는 중…</div>`);
    wire(container, pin, opts);
    summarizePin(pin)
        .then(() => {
            // 방금 만든 요약은 펼친 채로 보여준다(접힌 미리보기로 숨기지 않게)
            if (compact) expandedSummaries.add(pin.id);
            mountPinSummary(container, pin, opts);
            onChange?.(pin);
        })
        .catch((e) => {
            paint(container, `<div class="aiblk__error notice notice--plain tone-del">${escapeHtml(e.message || "요약에 실패했어요.")}</div>`);
            wire(container, pin, opts);
        });

    function wire(box, p, o) {
        box.onclick = (e) => {
            const act = e.target.closest("[data-ai-act]")?.dataset.aiAct;
            if (!act) return;
            e.stopPropagation();
            if (act === "again") {
                clearPinSummary(p.id);
                mountPinSummary(box, p, { ...o, autoRun: true });
            } else if (act === "expand") {
                expandedSummaries.add(p.id);
                mountPinSummary(box, p, o);
            } else if (act === "fold") {
                expandedSummaries.delete(p.id);
                mountPinSummary(box, p, o);
            } else if (act === "key" && saveKey(box.querySelector("[data-ai-key]")?.value)) {
                mountPinSummary(box, p, { ...o, autoRun: true });
            }
        };
        box.onkeydown = (e) => {
            const toggle = e.target.closest?.('[data-ai-act="expand"], [data-ai-act="fold"]');
            if (toggle && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                toggle.click();
                return;
            }
            if (e.key !== "Enter" || !e.target.matches("[data-ai-key]")) return;
            e.preventDefault();
            if (saveKey(e.target.value)) mountPinSummary(box, p, { ...o, autoRun: true });
        };
    }
}

/** 닫혀 있으면 펼치면서, 열려 있으면 높이를 이어 흐르게 하면서 내용을 바꾼다. */
function paint(box, html) {
    if (box.hidden) { box.innerHTML = html; expand(box); }
    else morph(box, () => { box.innerHTML = html; });
}

function fmtWhen(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} 요약`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) 비교 탭: 지금 보고 있는 A · B 두 화면으로 요약
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// 3) "지난번 이후" 브리핑 — 마지막으로 확인한 시점(또는 고른 핀)부터 지금까지
//    이미지는 보내지 않는다(글 재료만) — 가볍고 빠르게.
// ─────────────────────────────────────────────────────────────────────────────
const BRIEFING_STORAGE = "abl_briefing_summary";

export function getBriefingSummary(from, to) {
    try {
        const saved = JSON.parse(localStorage.getItem(BRIEFING_STORAGE) || "null");
        if (!saved || from == null) return saved;
        return saved.fromKey === store.timeKeys[from] && saved.toKey === store.timeKeys[to] ? saved : null;
    } catch { return null; }
}
export function clearBriefingSummary() {
    try { localStorage.removeItem(BRIEFING_STORAGE); } catch { }
}

export async function summarizeBriefing(from, to) {
    const apiKey = getKey();
    if (!apiKey) throw new Error("API 키가 필요해요.");
    const fromKey = store.timeKeys[from], toKey = store.timeKeys[to];
    const diff = diffBetween(from, to);
    const rw = segmentRework(from, to);
    const newPins = store.pins.filter((p) => p.index > from && p.index <= to);

    const recordings = getSendTranscripts() ? segmentRecordings(fromKey, toKey) : null;
    const context = {
        기간: { 이전: timeLabel(fromKey), 현재: timeLabel(toKey), 기록_시점_수: to - from },
        새_핀: newPins.map((p) => ({ ...pinSummary(p), 시각: timeLabel(store.timeKeys[p.index]) })),
        변경_요소_수: { 추가: diff.addedIds.length, 삭제: diff.deletedIds.length, 수정: diff.modified.after.length },
        수정이_아닌_갱신: updatesContext(diff),
        층_카테고리별_변화: levelRows(diff),
        물량_변화: quantityDeltas(fromKey, toKey),
        수정_내용: modsContext(diff),
        작업_흐름: { 편집: rw.edits, 확정된_요소: rw.settled, 실작업_분: Math.round(rw.activeMs / 60000) },
        구간_내부_과정: segmentProcess(from, to),
        변경_순서: changeSequence(from, to, 16),   // 짧은 브리핑만 큰 묶음 16개로 줄인다(Commit 해석은 전부 보낸다)
        ...(recordings ? { 구간_녹음: recordings } : {}),
        메모_없는_핀: newPins.filter((p) => !p.note).map((p) => p.title),
    };

    const instructions = [
        "아래는 사용자가 마지막으로 확인한 뒤(이전) 지금(현재)까지 BIM 모델에서 바뀐 내용입니다. 오랜만에 돌아온 사람에게 브리핑하듯 쓰세요.",
        "숫자는 이미 계산된 값입니다. 그대로 인용하고, 직접 계산하거나 없는 수치를 지어내지 마세요.",
        RULE_UPDATES,
        RULE_SEQUENCE,
        "이미지는 없으니 공간은 수치로만 판단하세요.",
        "",
        decisionFormat({
            relation: "'변경_순서'(시간 순)와 새 핀",
            observed: "새로 생긴 것 · 없어진 것 · 고친 것을 층·카테고리 기준으로 큰 것부터 2~4줄.",
            spatial: "층 · 카테고리 분포와 물량 증감으로 어느 층에 작업이 몰렸고 무엇이 늘거나 줄었는지 1~2줄.",
            inferred: `해석은 1~2개. 마지막에 '확인해 볼 것:' 뒤에 '구간_내부_과정'에서 생성 후 삭제되거나 변경 후 되돌린 객체가 많은 곳, 메모 없는 핀${recordings ? ", 녹음과 어긋나 보이는 곳" : ""}을 한 줄로 쓰세요(없으면 생략).`,
            length: "오랜만에 돌아온 사람이 읽기 좋게 짧게, 전체 10문장을 넘기지 마세요.",
        }),
    ].join("\n");

    const { text, settings } = await ask(apiKey, instructions, context, []);
    const data = {
        ...answerHtml(text),
        model: getModel(),
        at: Date.now(),
        prompt: { 지시문: instructions, ...settings },
        fromKey,
        toKey,
        facts: collectFacts(context),
        evidence: {
            구간: context.기간,
            변경_요소_수: context.변경_요소_수,
            층_카테고리별_변화: context.층_카테고리별_변화,
            물량_변화: context.물량_변화,
            수정이_아닌_갱신: context.수정이_아닌_갱신,
            수정_내용: context.수정_내용,
            변경_순서: context.변경_순서,
            구간_내부_과정: context.구간_내부_과정,
            ...outsideEvidence(from, to),
            보낸_이미지: [],
            구간_녹음: (context.구간_녹음 || []).map((r) => ({ 이름: r.이름, 전사됨: Boolean(r.전사) })),
        },
    };
    try { localStorage.setItem(BRIEFING_STORAGE, JSON.stringify(data)); } catch { }
    return data;
}

/** 브리핑 AI 블록 — 이 구간의 저장본이 있으면 보여주고, autoRun 이면 새로 만든다 */
export function mountBriefingSummary(container, from, to, { autoRun = false } = {}) {
    if (!container) return;
    const saved = getBriefingSummary(from, to);

    if (saved && !autoRun) {
        const check = checkSaved(saved);
        paint(container, `
            <div class="aiblk__body">${sectionize(check.html)}</div>
            ${checkBarHtml(check.stats)}
            ${evidenceHtml(saved.evidence, saved.prompt)}
            ${rateSlot()}
            <div class="aiblk__foot">
                <span class="aiblk__model">${escapeHtml(saved.model || "")} · ${fmtWhen(saved.at)}</span>
                <button class="btn btn--ghost btn--xs" type="button" data-brai="again">${icon("refresh", 12)}다시 만들기</button>
            </div>`);
        if (LAB) mountRating(container.querySelector(".rate"), {
            kind: "briefing",
            id: `${saved.fromKey}→${saved.toKey}`,
            meta: {
                title: "지난번 이후 브리핑",
                timestamp: saved.toKey,
                from, to,
                model: saved.model,
                summarizedAt: saved.at,
                summary: plainText(saved.html),
                check: check.stats,
            },
        });
        wireCheckToggle(container);
        wire();
        return;
    }
    if (!autoRun) {
        paint(container, `
            <div class="aiblk__cta">
                <span>바뀐 숫자 · 수정 내용 · 작업 흐름을 읽고 몇 문장으로 정리해요. 이미지는 보내지 않아요.</span>
                <button class="btn btn--primary btn--xs" type="button" data-brai="run">${icon("sparkle", 12)}AI 브리핑</button>
            </div>`);
        wire();
        return;
    }
    if (!hasKey()) {
        paint(container, `
            <div class="aiblk__key">
                <span>OpenAI API 키를 입력하면 이 구간을 브리핑해요. 키는 이 브라우저에만 저장돼요.</span>
                <div class="aiblk__key-row field-row">
                    <input class="field field--sm" type="password" placeholder="sk-..." autocomplete="off" spellcheck="false" data-brai-key>
                    <button class="btn btn--sm btn--primary" type="button" data-brai="key">저장</button>
                </div>
            </div>`);
        wire();
        container.querySelector("[data-brai-key]")?.focus();
        return;
    }
    paint(container, `<div class="aiblk__loading busy"><span class="spinner"></span>바뀐 내용을 읽고 브리핑을 쓰는 중…</div>`);
    wire();
    summarizeBriefing(from, to)
        .then(() => mountBriefingSummary(container, from, to))
        .catch((e) => { paint(container, `<div class="aiblk__error notice notice--plain tone-del">${escapeHtml(e.message || "브리핑에 실패했어요.")}</div>`); wire(); });

    function wire() {
        container.onclick = (e) => {
            const act = e.target.closest("[data-brai]")?.dataset.brai;
            if (!act) return;
            e.stopPropagation();
            if (act === "run") mountBriefingSummary(container, from, to, { autoRun: true });
            else if (act === "again") { clearBriefingSummary(); mountBriefingSummary(container, from, to, { autoRun: true }); }
            else if (act === "key" && saveKey(container.querySelector("[data-brai-key]")?.value)) mountBriefingSummary(container, from, to, { autoRun: true });
        };
        container.onkeydown = (e) => {
            if (e.key !== "Enter" || !e.target.matches("[data-brai-key]")) return;
            e.preventDefault();
            if (saveKey(e.target.value)) mountBriefingSummary(container, from, to, { autoRun: true });
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) 프로젝트 전체 서술 — 핀 전부를 한 번에 읽고 "이렇게 진행됐다"를 쓴다
//
// 핀별 요약을 이미 만들어 두었다면 그것까지 재료로 쓴다(계층 요약).
// 이미지는 처음과 마지막 모델 정면 두 장만 보낸다(맥락용).
// ─────────────────────────────────────────────────────────────────────────────
const PROJECT_SUMMARY_STORAGE = "abl_project_summary";

export function getProjectSummary() {
    try { return JSON.parse(localStorage.getItem(PROJECT_SUMMARY_STORAGE) || "null"); } catch { return null; }
}
export function clearProjectSummary() {
    try { localStorage.removeItem(PROJECT_SUMMARY_STORAGE); } catch { }
}
function saveProjectSummary(data) {
    try { localStorage.setItem(PROJECT_SUMMARY_STORAGE, JSON.stringify(data)); } catch { }
}

export async function summarizeProject() {
    const apiKey = getKey();
    if (!apiKey) throw new Error("API 키가 필요해요.");
    if (!store.pins.length) throw new Error("핀이 없어서 서술할 진행이 없어요.");

    const lastIndex = store.timeKeys.length - 1;
    const segments = store.pins.map((pin, i) => {
        const { from } = pinRange(pin);   // 첫 구간은 빈 모델에서 시작한다
        const diff = diffBetween(from, pin.index);
        const saved = getPinSummary(pin.id);
        return {
            순서: i + 1,
            시각: timeLabel(store.timeKeys[pin.index]),
            단계: pin.stage || null,
            제목: pin.title,
            메모: pin.note || null,
            출처: pin.source === "viewer" ? "뷰어(회고)" : "Revit",
            변경_요소_수: {
                추가: diff.addedIds.length,
                삭제: diff.deletedIds.length,
                수정: diff.modified.after.length,
            },
            주요_수정_항목: summarizeModifications(diff).groups.slice(0, 3).map((g) => `${g.group} ${g.count}`),
            주요_층_카테고리: levelRows(diff)
                .sort((a, b) => (b.추가 + b.삭제 + b.수정) - (a.추가 + a.삭제 + a.수정))
                .slice(0, 4),
            구간_녹음: segmentRecordings(from < 0 ? null : store.timeKeys[from], store.timeKeys[pin.index]).map((r) => r.이름),
            이미_만든_요약: saved ? plainText(saved.html).slice(0, 500) : null,
        };
    });

    const context = {
        프로젝트: store.docTitle || null,
        기간: {
            시작: timeLabel(store.timeKeys[0]),
            끝: timeLabel(store.timeKeys[lastIndex]),
            기록_시점_수: store.timeKeys.length,
        },
        핀_수: store.pins.length,
        전체_물량_변화: quantityDeltas(store.timeKeys[0], store.timeKeys[lastIndex]),
        구간들: segments,
        이미지_설명: { 순서: ["첫 시점 남측(정면)", "마지막 시점 남측(정면)"] },
    };

    const images = [
        ...captureViews({ index: 0, dirs: [VIEWS[0].dir] }),
        ...captureViews({ index: lastIndex, dirs: [VIEWS[0].dir] }),
    ];

    const instructions = [
        "아래는 한 BIM 프로젝트의 작업 이력입니다. 핀(작업 시점 표시)마다 그 구간에서 실제로 바뀐 요소 수와 층·카테고리가 계산되어 있습니다.",
        "숫자는 이미 계산된 값입니다. 그대로 인용하고, 직접 계산하거나 없는 수치를 지어내지 마세요.",
        "이미지는 첫 시점과 마지막 시점의 정면 두 장입니다. 전체 결과를 설명할 때만 참고하세요.",
        "'수정'은 구간 양 끝을 비교해 입력 값이 달라진 요소만 센 것입니다(결과값만 달라졌거나 차이 없이 갱신된 요소는 세지 않았습니다).",
        "",
        decisionFormat({
            relation: "'구간들'의 순서(핀 순서)",
            observed: "설계 단계(기획·계획설계·기본설계·실시설계·검토)별로 무엇이 얼마나 바뀌었는지 한 줄씩, 숫자와 함께. 단계가 없으면 시간 순 묶음으로 나누세요.",
            spatial: "프로젝트 전체에서 어느 층 · 카테고리가 어떻게 커지거나 바뀌었는지, '전체_물량_변화'와 함께 2~3줄.",
            inferred: "변경량이 특히 큰 구간이나 방향이 바뀐 지점(전환점)마다 어떤 설계 의사결정이었는지 해석하세요. 마지막에 '기록의 빈틈:' 뒤에 변경량이 큰데 핀 메모가 없거나 메모와 실제 변경이 어긋난 구간을 한 줄로 쓰세요(없으면 생략).",
            length: "전체 14문장을 넘기지 마세요.",
        }),
    ].join("\n");

    const { text, settings } = await ask(apiKey, instructions, context, images);
    const data = {
        ...answerHtml(text),
        model: getModel(),
        at: Date.now(),
        prompt: { 지시문: instructions, ...settings },
        pinCount: store.pins.length,
        lastPinId: store.pins[store.pins.length - 1]?.id || null,
        facts: collectFacts(context),
    };
    saveProjectSummary(data);
    return data;
}

/** 프로젝트 서술 블록을 그린다(이력 화면 상단). */
export function mountProjectSummary(container, { autoRun = false, onChange } = {}) {
    if (!container) return;
    const saved = getProjectSummary();

    if (saved && !autoRun) {
        const stale = saved.pinCount !== store.pins.length || saved.lastPinId !== (store.pins[store.pins.length - 1]?.id || null);
        const check = checkSaved(saved);
        paint(container, `
            ${stale ? `<div class="aiblk__stale notice tone-mod">${icon("alert", 12)}그 뒤로 핀이 바뀌었어요. 다시 쓰면 지금 이력으로 정리해요.</div>` : ""}
            <div class="aiblk__body">${sectionize(check.html)}</div>
            ${checkBarHtml(check.stats)}
            ${rateSlot()}
            <div class="aiblk__foot">
                <span class="aiblk__model">${escapeHtml(saved.model || "")} · 핀 ${saved.pinCount}개 기준 · ${fmtWhen(saved.at)}</span>
                <button class="btn btn--ghost btn--xs" type="button" data-proj-act="again">${icon("refresh", 12)}다시 쓰기</button>
                <button class="btn btn--ghost btn--xs" type="button" data-proj-act="close">${icon("x", 12)}닫기</button>
            </div>`);
        if (LAB) mountRating(container.querySelector(".rate"), {
            kind: "project",
            id: "project",
            meta: {
                title: store.docTitle || "프로젝트 전체",
                timestamp: store.timeKeys[store.timeKeys.length - 1] || "",
                from: 0,
                to: store.timeKeys.length - 1,
                model: saved.model,
                summarizedAt: saved.at,
                summary: plainText(saved.html),
                check: check.stats,
            },
        });
        wireCheckToggle(container);
        wire();
        return;
    }

    if (!hasKey()) {
        paint(container, `
            <div class="aiblk__key">
                <span>OpenAI API 키를 입력하면 핀 전체를 읽고 프로젝트 진행을 서술해요. 키는 이 브라우저에만 저장돼요.</span>
                <div class="aiblk__key-row field-row">
                    <input class="field field--sm" type="password" placeholder="sk-..." autocomplete="off" spellcheck="false" data-proj-key>
                    <button class="btn btn--sm btn--primary" type="button" data-proj-act="key">저장</button>
                </div>
            </div>`);
        wire();
        container.querySelector("[data-proj-key]")?.focus();
        return;
    }

    paint(container, `<div class="aiblk__loading busy"><span class="spinner"></span>핀 ${store.pins.length}개를 읽고 진행을 정리하는 중…</div>`);
    wire();
    summarizeProject()
        .then(() => { mountProjectSummary(container, { onChange }); onChange?.(); })
        .catch((e) => { paint(container, `<div class="aiblk__error notice notice--plain tone-del">${escapeHtml(e.message || "서술에 실패했어요.")}</div>`); wire(); });

    function wire() {
        container.onclick = (e) => {
            const act = e.target.closest("[data-proj-act]")?.dataset.projAct;
            if (!act) return;
            e.stopPropagation();
            if (act === "again") { clearProjectSummary(); mountProjectSummary(container, { autoRun: true, onChange }); }
            else if (act === "close") { container.hidden = true; onChange?.(); }
            else if (act === "key" && saveKey(container.querySelector("[data-proj-key]")?.value)) {
                mountProjectSummary(container, { autoRun: true, onChange });
            }
        };
        container.onkeydown = (e) => {
            if (e.key !== "Enter" || !e.target.matches("[data-proj-key]")) return;
            e.preventDefault();
            if (saveKey(e.target.value)) mountProjectSummary(container, { autoRun: true, onChange });
        };
    }
}

export function initAiSummary() {
    if (window.__ablAiInit) return;
    window.__ablAiInit = true;

    const section = document.getElementById("ai-summary");
    if (!section) return;
    // 비교 탭의 AI 요약은 핀 · Commit 해석과 겹치는 실험 기능 — 평소에는 숨기고 ?lab=1 에서만 연다
    section.hidden = !LAB;
    const runBtn = document.getElementById("ai-run");
    const output = document.getElementById("ai-output");
    const loading = document.getElementById("ai-loading");
    const keyRow = document.getElementById("ai-key-row");
    const keyInput = document.getElementById("ai-key");
    const keySave = document.getElementById("ai-key-save");
    const keyBtn = document.getElementById("ai-key-btn");
    const modelSel = document.getElementById("ai-model");
    const modelRefresh = document.getElementById("ai-model-refresh");

    let stale = false;

    renderModels(cachedModelList());
    modelSel?.addEventListener("change", () => setModel(modelSel.value));
    modelSel?.addEventListener("blur", () => { if (!modelSel.value.trim()) modelSel.value = getModel(); });
    modelRefresh?.addEventListener("click", () => refreshModels(true));

    // 키가 있으면 계정에서 쓸 수 있는 모델을 알아서 불러온다(하루 한 번)
    if (hasKey() && modelListAge() > 24 * 60 * 60 * 1000) refreshModels(false);

    async function refreshModels(manual) {
        const apiKey = getKey();
        if (!apiKey) { if (manual) toggleKeyRow(true); return; }
        if (modelRefresh) modelRefresh.disabled = true;
        try {
            renderModels(await fetchModelList(apiKey));
        } catch (e) {
            if (manual) output.innerHTML = `<div class="ai-error notice notice--plain tone-del">${escapeHtml(e.message)}</div>`;
        } finally {
            if (modelRefresh) modelRefresh.disabled = false;
        }
    }

    function renderModels(list) {
        const datalist = document.getElementById("ai-model-list");
        if (!modelSel || !datalist) return;
        const current = getModel();
        const items = list.map((m) => (typeof m === "string" ? { id: m, label: "" } : m));
        if (!items.some((m) => m.id === current)) items.unshift({ id: current, label: "" });
        datalist.innerHTML = items
            .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label || "")}</option>`)
            .join("");
        modelSel.value = current;
    }

    runBtn?.addEventListener("click", run);
    keyBtn?.addEventListener("click", () => toggleKeyRow(keyRow.hidden));
    keySave?.addEventListener("click", () => {
        if (!saveKey(keyInput.value)) return;
        keyInput.value = "";
        toggleKeyRow(false);
        updateKeyButton();
        run();
    });
    keyInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") keySave.click(); });

    on("time:main", markStale);
    on("filters", markStale);
    on("split", (open) => { if (!open) markStale(); });
    updateKeyButton();

    function updateKeyButton() {
        if (!keyBtn) return;
        keyBtn.textContent = hasKey() ? "API 키 변경" : "API 키";
        keyBtn.classList.toggle("is-set", hasKey());
    }

    function toggleKeyRow(show) {
        if (!keyRow) return;
        keyRow.hidden = !show;
        if (show) keyInput.focus();
    }

    function markStale() {
        if (!output || output.dataset.filled !== "1" || stale) return;
        stale = true;
        output.insertAdjacentHTML("afterbegin",
            `<div class="ai-stale notice notice--xs tone-mod">${icon("alert", 13)}시점이나 필터가 바뀌었어요. 다시 요약하세요.</div>`);
    }

    function setLoading(on) {
        loading?.classList.toggle("is-active", on);
        loading?.setAttribute("aria-hidden", String(!on));
        if (runBtn) {
            runBtn.disabled = on;
            runBtn.textContent = on ? "요약 중…" : "요약하기";
        }
    }

    async function run() {
        if (!store.split) {
            output.innerHTML = `<div class="diff-filter-empty">비교를 먼저 여세요.</div>`;
            return;
        }
        const apiKey = getKey();
        if (!apiKey) { toggleKeyRow(true); return; }

        const s = store.compareState?.();
        if (!s) {
            output.innerHTML = `<div class="diff-filter-empty">비교할 데이터가 없어요.</div>`;
            return;
        }

        setLoading(true);
        try {
            // 분할을 막 열었으면 A 화면이 아직 기본 크기(300×150)일 수 있다 — 크기를 맞추고 두 프레임 기다린다
            store.compareViewer?.prepareCapture?.();
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            store.compareViewer?.prepareCapture?.();
            const lo = Math.min(s.beforeIndex, s.afterIndex), hi = Math.max(s.beforeIndex, s.afterIndex);
            // 분할 비교의 차이(필터가 걸린 것)를 핀 요약과 같은 뜻으로 다시 나눈다 — 수정은 입력 값이 달라진 요소만
            const diff = classifyDiff(s.diff, lo, hi);
            const plans = planShots(s.beforeIndex, s.afterIndex, diff);
            const images = [
                shrink(store.compareViewer?.renderer?.domElement),
                shrink(store.viewer?.renderer?.domElement),
                ...plans.images,
            ];
            const imageLabels = ["A(이전) 화면", "B(현재) 화면", ...plans.labels];
            const pinA = pinAtIndex(s.beforeIndex);
            const pinB = pinAtIndex(s.afterIndex);
            const context = {
                시점: {
                    A: { 시각: timeLabel(s.beforeKey), 핀: pinSummary(pinA) },
                    B: { 시각: timeLabel(s.afterKey), 핀: pinSummary(pinB) },
                    구간_내_핀: store.pins
                        .filter((p) => p.index > Math.min(s.beforeIndex, s.afterIndex) && p.index <= Math.max(s.beforeIndex, s.afterIndex))
                        .map(pinSummary),
                },
                변경_요소_수: {
                    추가: diff.addedIds.length,
                    삭제: diff.deletedIds.length,
                    수정: diff.modified.after.length,
                    유지: diff.unchangedIds?.length ?? 0,
                },
                수정이_아닌_갱신: updatesContext(diff),
                층_카테고리별_변화: levelRows(diff),
                물량_변화: quantityDeltas(s.beforeKey, s.afterKey),
                수정_내용: modsContext(diff),
                변경_요소_예시: {
                    추가: sampleElements(diff.addedIds),
                    삭제: sampleElements(diff.deletedIds),
                    수정: sampleElements(diff.modified.after),
                },
                변경_순서: changeSequence(lo, hi),
                적용된_필터: s.filters,
                이미지_설명: {
                    순서: imageLabels,
                    ...(plans.images.length ? { 평면: PLAN_NOTE, 평면_층: plans.info } : {}),
                },
            };
            const instructions = [
                "아래는 BIM 모델의 두 시점(A: 이전, B: 현재)을 비교한 결과입니다.",
                "숫자(물량·개수·층별 변화)는 이미 계산된 값입니다. 그대로 인용하고, 직접 계산하거나 없는 수치를 지어내지 마세요.",
                `이미지는 순서대로 ${imageLabels.join(", ")} 입니다. 형태·배치·공간 관계를 읽는 데만 쓰고, 이미지에서 수량을 세지 마세요.`,
                RULE_UPDATES,
                RULE_SEQUENCE + " 층 · 카테고리 필터가 걸려 있으면 '변경_순서'는 필터와 상관없이 구간 전체의 순서입니다.",
                "",
                decisionFormat({
                    relation: "'변경_순서'(시간 순)",
                    observed: "추가·삭제·수정 요소 수, 층별 변화, '수정_내용'의 항목과 예시 문장을 숫자와 함께 3~6줄.",
                    spatial: plans.images.length
                        ? "이전·현재 평면을 비교해 어느 층 어느 쪽(방위)에서 실 구획·통로·개구부(문·창) 배치가 어떻게 달라졌는지, 물량 증감과 함께 2~4줄. 인접 층 평면이 있으면 층 사이 관계도 보세요."
                        : "두 화면에서 실제로 보이는 형태·배치 차이를 물량 증감과 함께 2~4줄.",
                    inferred: "구간의 핀 제목·메모가 있으면 해석과 대조하고, 메모에 없는 변경은 분명히 짚으세요. 해석은 1~3개.",
                }),
            ].join("\n");

            const { text } = await ask(apiKey, instructions, context, images);
            const check = checkNumbers(renderMarkdown(text || "요약을 받지 못했어요."), collectFacts(context));
            output.innerHTML = `<div class="ai-output__body">${sectionize(check.html)}</div>${checkBarHtml(check.stats)}`;
            wireCheckToggle(output);
            output.dataset.filled = "1";
            stale = false;
        } catch (e) {
            output.innerHTML = `<div class="ai-error notice notice--plain tone-del">${escapeHtml(e.message || "요청에 실패했어요.")}</div>`;
        } finally {
            setLoading(false);
        }
    }

    function shrink(canvas) {
        if (!canvas) return null;
        try {
            const scale = Math.min(1, IMAGE_WIDTH / canvas.width);
            const c = document.createElement("canvas");
            c.width = Math.round(canvas.width * scale);
            c.height = Math.round(canvas.height * scale);
            c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
            return c.toDataURL("image/jpeg", 0.8);
        } catch (e) {
            console.warn("[ai] 화면 캡처 실패:", e);
            return null;
        }
    }
}
