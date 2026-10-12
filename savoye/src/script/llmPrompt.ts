
type SceneAPI = {
  getState?: () => Record<string, unknown> | null;
};

function getSceneState(): Record<string, unknown> | null {
  const api = (window as any).__SCENE_API__ as SceneAPI | undefined;
  if (!api?.getState) return null;
  try {
    return api.getState() ?? null;
  } catch {
    return null;
  }
}

function collectAvailableCategories(ctx: any): string[] {
  const set = new Set<string>();

  const quantity = ctx?.quantity ?? {};
  Object.keys(quantity).forEach((k) => set.add(k));

  const diff = ctx?.diff ?? {};
  const added = diff?.added ?? {};
  const deleted = diff?.deleted ?? {};
  Object.keys(added).forEach((k) => set.add(k));
  Object.keys(deleted).forEach((k) => set.add(k));

  const modified = diff?.modified ?? {};
  const before = modified?.before ?? {};
  const after = modified?.after ?? {};
  Object.keys(before).forEach((k) => set.add(k));
  Object.keys(after).forEach((k) => set.add(k));

  return Array.from(set).sort();
}

export function buildSystemMessage(getToolSpecs: () => unknown) {
  // IMPORTANT:
  // - Model must NEVER mention <cmd> tags or ask user to paste JSON.
  // - If tools are needed, model must include JSON array inside <cmd> ... </cmd> silently.
  // - Response text must be short and only contain the outcome/analysis.
  return {
    role: "system",
    content:
      [
        "You are a BIM design-change analyst.",
        "Explain changes as a sequential flow and cite revision IDs, categories, and quantity deltas when available.",
        "Prefer panel-visible metadata before reading logs: getVisibleStats / compareVisibleStats / getVisibleByCategory / getVisibleElements.",
        "Only use categories that exist in availableCategories. If the user requests a missing category, ask one short clarification question.",
        "Never instruct the user to paste JSON and never mention <cmd> tags.",
        "If tools are needed, include a JSON ARRAY of commands silently between <cmd> and </cmd>.",
        'Example (do not mention this example): <cmd>[{"action":"compareVisibleStats"}]</cmd>',
        "Respond with 1–4 short sentences. No long paragraphs.",
        `Tools: ${JSON.stringify(getToolSpecs())}`,
      ].join(" "),
  };
}

export function buildLlmContext() {
  const ctx = (window as any).__LLM_CONTEXT__;
  if (!ctx) return "";

  const availableCategories = collectAvailableCategories(ctx);
  const state = getSceneState();

  const payload = {
    beforeRevision: ctx.beforeRevision ?? null,
    afterRevision: ctx.afterRevision ?? null,
    quantity: ctx.quantity ?? null,
    diff: ctx.diff ?? null,
    availableCategories,
    state,
  };

  return [
    "Context: Use the following revision comparison data.",
    "Goal: sequential change analysis (what changed first → next → final).",
    "Prefer visible panel stats over reading logs unless needed.",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

export function stripCommandBlocks(text: string) {
  return String(text).replace(/<cmd>[\s\S]*?<\/cmd>/g, "").trim();
}

export function sanitizeAssistantText(text: string) {
  // Only remove hidden tool blocks. Keep the actual explanation.
  const cleaned = stripCommandBlocks(text).trim();

  if (!cleaned) return "요청을 처리했어요.";

  // Keep it short: at most first 4 sentences / 4 lines
  const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const joined = lines.join(" ");

  // Sentence-ish split (lightweight)
  const parts = joined.split(/(?<=[.!?。？！])\s+/).filter(Boolean);
  const short = parts.slice(0, 4).join(" ").trim();

  return short || "요청을 처리했어요.";
}