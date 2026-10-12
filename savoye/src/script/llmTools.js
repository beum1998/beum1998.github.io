function safeParseJsonArray(jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    return null;
  } catch {
    return null;
  }
}

export function extractCommands(text) {
  const blocks = String(text).match(/<cmd>([\s\S]*?)<\/cmd>/g);
  if (!blocks) return [];

  const commands = [];
  for (const block of blocks) {
    const jsonText = block.replace(/<\/?cmd>/g, "").trim();
    const list = safeParseJsonArray(jsonText);
    if (!list) continue;

    for (const item of list) {
      if (item && typeof item.action === "string") commands.push(item);
    }
  }
  return commands;
}

export function executeCommands(commands) {
  if (!commands || commands.length === 0) return [];
  const results = [];
  for (const cmd of commands) {
    const res = runSceneCommand(cmd);
    if (res !== undefined) results.push(res);
  }
  return results;
}

export function buildToolSummary(commands) {
  if (!commands || commands.length === 0) return "";

  const lines = commands.map((cmd) => {
    switch (cmd.action) {
      case "isolate": {
        const list = Array.isArray(cmd.categories) ? cmd.categories.join(", ") : "";
        return list ? `요청한 카테고리만 표시했어요: ${list}.` : "요청한 카테고리만 표시했어요.";
      }
      case "clearIsolation":
      case "clearFilters":
        return "격리/필터 상태를 해제했어요.";
      case "setFilters": {
        const list = Array.isArray(cmd.categories) ? cmd.categories.join(", ") : "";
        return list ? `카테고리 필터를 적용했어요: ${list}.` : "카테고리 필터를 적용했어요.";
      }
      case "setColor":
        return `${cmd.category} 색상을 ${cmd.color}로 변경했어요.`;
      case "colorElements":
        return `선택 요소 ${(cmd.elementIds || []).length}개 색상을 변경했어요.`;
      case "resetColors":
      case "restoreColors":
        return "색상을 원래 상태로 되돌렸어요.";
      case "highlightChanged":
        return "변경된 요소를 강조 표시했어요.";
      case "setTime": {
        const panel = cmd.panel || "both";
        const target = panel === "before" ? "A" : panel === "after" ? "B" : "A/B";
        return `${target} 시점을 ${cmd.timeKey}로 이동했어요.`;
      }
      case "saveTimeLeft":
        return cmd.timeKey ? `좌측 시간 ${cmd.timeKey}을 저장했어요.` : "좌측 현재 시간을 저장했어요.";
      case "setChangeFilter":
        return `변경 필터를 적용했어요: ${cmd.changeType}.`;
      case "setCameraSync":
        return cmd.enabled ? "카메라 동기화를 켰어요." : "카메라 동기화를 껐어요.";
      default:
        return "요청한 작업을 적용했어요.";
    }
  });

  return lines.join(" ");
}

export function runSceneCommand(cmd) {
  const api = window.__SCENE_API__;
  if (!api || !cmd || typeof cmd.action !== "string") return;

  switch (cmd.action) {
    case "getState":
      return { action: "getState", data: api.getState?.() ?? null };

    case "saveTimeLeft":
      api.saveTimeLeft?.(cmd.timeKey ?? null);
      return { action: "saveTimeLeft", timeKey: cmd.timeKey ?? null };

    case "setFilters":
      api.setCategoryFilter?.(cmd.categories ?? []);
      return { action: "setFilters", categories: cmd.categories ?? [] };

    case "clearFilters":
      api.clearFilters?.();
      return { action: "clearFilters" };

    case "setCameraSync":
      api.setSyncCamera?.(Boolean(cmd.enabled));
      return { action: "setCameraSync", enabled: Boolean(cmd.enabled) };

    case "setTime":
      if (cmd.timeKey) api.setTime?.(cmd.panel ?? "both", cmd.timeKey);
      return { action: "setTime", timeKey: cmd.timeKey ?? null, panel: cmd.panel ?? "both" };

    case "readTimeLog":
      return { action: "readTimeLog", data: api.readTimeLog?.(cmd.timeKey) ?? null };

    case "readQuantityLog":
      return { action: "readQuantityLog", data: api.readQuantityLog?.(cmd.timeKey) ?? null };

    case "readShapeLog":
      return { action: "readShapeLog", data: api.readShapeLog?.(cmd.elementIds ?? []) ?? null };

    case "getVisibleElements":
      return { action: "getVisibleElements", data: api.getVisibleElements?.(cmd.panel ?? "before") ?? [] };

    case "getVisibleByCategory":
      return {
        action: "getVisibleByCategory",
        data: api.getVisibleByCategory?.(cmd.panel ?? "before", cmd.category) ?? [],
      };

    case "getVisibleStats":
      return { action: "getVisibleStats", data: api.getVisibleStats?.(cmd.panel ?? "before") ?? {} };

    case "compareVisibleStats":
      return { action: "compareVisibleStats", data: api.compareVisibleStats?.() ?? {} };

    case "colorElements":
      api.colorByIds?.(cmd.elementIds ?? [], parseColor(cmd.color ?? "#ffd400"));
      return { action: "colorElements", count: (cmd.elementIds ?? []).length };

    case "setChangeFilter":
      api.setChangeFilter?.(cmd.changeType);
      return { action: "setChangeFilter", changeType: cmd.changeType };

    case "isolate":
      api.isolateCategories?.(cmd.categories ?? []);
      return { action: "isolate", categories: cmd.categories ?? [] };

    case "clearIsolation":
      api.clearIsolation?.();
      return { action: "clearIsolation" };

    case "setColor":
      if (cmd.category && cmd.color) api.setCategoryColor?.(cmd.category, parseColor(cmd.color));
      return { action: "setColor", category: cmd.category ?? null, color: cmd.color ?? null };

    case "resetColors":
      api.resetColors?.();
      return { action: "resetColors" };

    case "restoreColors":
      api.restoreColors?.();
      return { action: "restoreColors" };

    case "highlightChanged":
      api.highlightChanged?.(parseColor(cmd.color ?? "#ffd400"));
      return { action: "highlightChanged", color: cmd.color ?? "#ffd400" };

    default:
      return { action: cmd.action, status: "ignored" };
  }
}

export function parseColor(value) {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const v = value.trim();
    if (v.startsWith("#")) return parseInt(v.replace("#", "0x"), 16);
    if (v.startsWith("0x")) return parseInt(v, 16);
  }
  return 0xffd400;
}
