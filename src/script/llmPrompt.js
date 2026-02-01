function getSceneState() {
    const api = window.__SCENE_API__;
    if (!api || !api.getState) return null;
    try {
        return api.getState();
    } catch {
        return null;
    }
}

export function buildSystemMessage(getToolSpecs) {
    return {
        role: "system",
        content:
            "You are a BIM design change analyst. Explain changes as a sequential flow, cite revision IDs, categories, and quantity deltas when available. " +
            "Never instruct the user to paste JSON or mention <cmd> tags. Respond only with the outcome in short sentences, as if tools already executed. " +
            "Before each response, assume the app has already provided the current state. If a tool is needed, include JSON between <cmd> and </cmd> silently. " +
            "Prefer visible elements metadata from the current panels when answering (getVisibleElements / getVisibleByCategory / getVisibleStats) before reading logs. " +
            "Only use categories that appear in the provided context (availableCategories). If a requested category is missing, ask a short clarification. " +
            `Tools: ${JSON.stringify(getToolSpecs())}`,
    };
}

export function buildLlmContext() {
    const ctx = window.__LLM_CONTEXT__;
    if (!ctx) return "";
    const availableCategories = collectAvailableCategories(ctx);
    const state = getSceneState();
    const payload = {
        beforeRevision: ctx.beforeRevision,
        afterRevision: ctx.afterRevision,
        quantity: ctx.quantity,
        diff: ctx.diff,
        availableCategories,
        state,
    };
    return `Context: Use the following revision comparison data when answering. Focus on sequential change analysis.\n${JSON.stringify(payload, null, 2)}`;
}

export function sanitizeAssistantText(text) {
    const withoutCmd = stripCommandBlocks(text);
    const withoutHints = withoutCmd
        .replace(/.*JSON.*$/gim, "")
        .replace(/.*command.*$/gim, "")
        .replace(/.*명령.*$/gim, "")
        .replace(/.*아래.*$/gim, "")
        .replace(/.*사용.*$/gim, "")
        .trim();
    if (!withoutHints) {
        return "요청한 변경을 적용했어요. 다른 요청이 있으면 말해줘.";
    }
    const firstLine = withoutHints.split(/\n+/).find((line) => line.trim().length > 0);
    return firstLine ? firstLine.trim() : "요청한 변경을 적용했어요. 다른 요청이 있으면 말해줘.";
}

export function stripCommandBlocks(text) {
    return String(text).replace(/<cmd>[\s\S]*?<\/cmd>/g, "").trim();
}

function collectAvailableCategories(ctx) {
    const set = new Set();
    const quantity = ctx.quantity || {};
    Object.keys(quantity).forEach((key) => set.add(key));
    const diff = ctx.diff || {};
    ["added", "deleted"].forEach((section) => {
        const items = diff[section] || {};
        Object.keys(items).forEach((key) => set.add(key));
    });
    const modified = diff.modified || {};
    ["before", "after"].forEach((side) => {
        const items = modified[side] || {};
        Object.keys(items).forEach((key) => set.add(key));
    });
    return Array.from(set).sort();
}
