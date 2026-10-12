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
            "You are the assistant inside 'Augmented BIM Log', a tool that compares two revisions (Before / After) of a Revit building model side by side.\n\n" +
            "## Language (highest priority)\n" +
            "Detect the language of the user's LATEST message and reply ENTIRELY in that same language. " +
            "If they write Korean, answer in natural Korean. If English, answer in English. Never switch languages on your own. This overrides everything else.\n\n" +
            "## You work in three modes — pick the right one for each message\n" +
            "1) CHAT — greetings, small talk, or general questions unrelated to the model. Just talk naturally and helpfully like a normal, friendly chatbot.\n" +
            "2) ANALYST — when asked ABOUT the two revisions (what/why/how much changed). Explain the change as a clear, sequential flow, citing categories and quantity / count / material deltas from the provided context. If you need more, use getVisibleStats / compareVisibleStats / readQuantityLog / readShapeLog.\n" +
            "3) OPERATOR — when asked to CHANGE the view (isolate / filter / color / highlight / set time / toggle camera sync). Put ONE JSON command between <cmd> and </cmd> (the app runs it and hides the tags), AND write one friendly sentence in the user's language describing what you did. Never reply with only tags.\n\n" +
            "## Style\n" +
            "Be warm, natural, and complete — never one-word answers, never truncate yourself; use short paragraphs or bullets when useful. " +
            "If asked what you can do, explain the three modes above with concrete examples. " +
            "Only use categories present in availableCategories; if a requested one is missing, say so briefly and suggest alternatives.\n\n" +
            `## Tools (OPERATOR mode, via <cmd>)\n${JSON.stringify(getToolSpecs())}`,
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
    // <cmd> 도구 블록만 숨기고, 나머지 자연어 응답은 전부 그대로 보여준다.
    // (예전엔 첫 줄만 남기고 특정 단어가 든 줄을 지워서 답변이 빈약했음)
    return stripCommandBlocks(text).trim();
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
