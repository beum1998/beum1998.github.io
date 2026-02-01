import { buildLlmContext, buildSystemMessage, sanitizeAssistantText, stripCommandBlocks } from "./llmPrompt.js";
import { buildToolSummary, executeCommands, extractCommands } from "./llmTools.js";

const STORAGE_KEY = "openai_api_key";
const CHAT_HISTORY_KEY = "llm_chat_history";
const MODEL_NAME = "gpt-4o-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

export function initLlmPanel() {
    const keyInput = document.getElementById("llm-api-key");
    const saveButton = document.getElementById("llm-save-key");
    const clearButton = document.getElementById("llm-clear-key");
    const status = document.getElementById("llm-key-status");
    const chatLog = document.getElementById("llm-chat-log");
    const chatInput = document.getElementById("llm-chat-input");
    const chatSend = document.getElementById("llm-chat-send");
    const modal = document.getElementById("llm-modal");
    const diffTab = document.getElementById("llm-tab-diff");
    const chatTab = document.getElementById("llm-tab-chat");
    const keyButton = document.getElementById("llm-key-button");
    const resetButton = document.getElementById("llm-reset-button");
    const diffPanel = document.getElementById("llm-panel-diff");
    const chatPanel = document.getElementById("llm-panel-chat");
    const closeButtons = document.querySelectorAll("[data-llm-close]");

    if (!keyInput || !saveButton || !clearButton || !status || !chatLog || !chatInput || !chatSend) {
        return;
    }

    const systemMessage = buildSystemMessage(getToolSpecs);
    const chatHistory = loadChatHistory(systemMessage);
    let isSending = false;
    renderChatHistory(chatHistory, chatLog);

    if (chatTab) {
        chatTab.addEventListener("click", () => {
            const hasKey = Boolean(getStoredKey());
            setTab("chat");
            if (!hasKey && modal) {
                openModal();
            }
        });
    }

    if (diffTab) {
        diffTab.addEventListener("click", () => setTab("diff"));
    }

    keyButton?.addEventListener("click", () => {
        openModal();
    });

    if (modal && closeButtons.length) {
        closeButtons.forEach((button) => {
            button.addEventListener("click", () => {
                modal.classList.remove("is-open");
                modal.setAttribute("aria-hidden", "true");
            });
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                modal.classList.remove("is-open");
                modal.setAttribute("aria-hidden", "true");
            }
        });
    }

    const savedKey = getStoredKey();
    if (savedKey) {
        status.textContent = "Key status: saved locally";
        if (keyButton) {
            keyButton.textContent = "Complete";
            keyButton.classList.add("is-complete");
        }
    }

    saveButton.addEventListener("click", () => {
        const key = keyInput.value.trim();
        if (!key) {
            status.textContent = "Key status: not set";
            return;
        }
        localStorage.setItem(STORAGE_KEY, key);
        keyInput.value = "";
        status.textContent = "Key status: saved locally";
        if (keyButton) {
            keyButton.textContent = "Complete";
            keyButton.classList.add("is-complete");
        }
        closeModal();
        setTab("chat");
    });

    clearButton.addEventListener("click", () => {
        localStorage.removeItem(STORAGE_KEY);
        keyInput.value = "";
        status.textContent = "Key status: not set";
        if (keyButton) {
            keyButton.textContent = "API Key";
            keyButton.classList.remove("is-complete");
        }
        setTab("diff");
    });

    chatSend.addEventListener("click", async () => {
        if (isSending) return;
        const prompt = chatInput.value.trim();
        if (!prompt) return;

        const apiKey = getStoredKey();
        if (!apiKey) {
            pushMessage("assistant", "No API key found. Please save your key first.");
            openModal();
            return;
        }

        setLoading(true);
        chatInput.focus();
        chatInput.value = "";
        pushMessage("user", prompt);

        try {
            await runAgentLoop(apiKey);
        } catch (error) {
            pushMessage("assistant", `Error: ${error.message || "request failed"}`);
        } finally {
            setLoading(false);
            chatInput.focus();
        }
    });

    chatInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        if (event.shiftKey) return;
        if (isSending) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        chatSend.click();
    });

    function pushMessage(role, text) {
        chatHistory.push({ role, content: text });
        saveChatHistory(chatHistory);
        const bubble = document.createElement("div");
        bubble.className = `llm-bubble llm-bubble--${role}`;
        if (role === "assistant") {
            const commands = extractCommands(text);
            const displayText = commands.length ? buildToolSummary(commands) : sanitizeAssistantText(text);
            bubble.innerHTML = renderMarkdown(displayText);
        } else {
            bubble.textContent = text;
        }
        chatLog.appendChild(bubble);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    resetButton?.addEventListener("click", () => {
        clearChatHistoryInPlace(chatHistory, systemMessage);
        renderChatHistory(chatHistory, chatLog);
    });

    function setTab(tab) {
        if (diffTab) diffTab.classList.toggle("is-active", tab === "diff");
        if (chatTab) chatTab.classList.toggle("is-active", tab === "chat");
        if (diffPanel) diffPanel.classList.toggle("is-active", tab === "diff");
        if (chatPanel) chatPanel.classList.toggle("is-active", tab === "chat");
        if (tab === "chat" && chatLog) {
            chatLog.scrollTop = chatLog.scrollHeight;
            chatInput?.focus();
        }
    }

    function openModal() {
        if (!modal) return;
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
    }

    function setLoading(isLoading) {
        isSending = isLoading;
        chatSend.disabled = isLoading;
        chatSend.textContent = isLoading ? "Sending..." : "Send";
    }

    async function runAgentLoop(apiKey) {
        const maxTurns = 3;
        for (let step = 0; step < maxTurns; step += 1) {
            const responseText = await askOpenAI(apiKey, chatHistory, buildLlmContext());
            const safeText = responseText || "(empty response)";
            const commands = extractCommands(safeText);
            pushMessage("assistant", safeText);
            if (!commands.length) return;
            const toolResults = executeCommands(commands);
            if (toolResults.length) {
                chatHistory.push({
                    role: "system",
                    content: `ToolResult: ${JSON.stringify(toolResults)}`,
                });
            }
        }
    }

    setTab("diff");
}

function loadChatHistory(systemMessage) {
    try {
        const raw = localStorage.getItem(CHAT_HISTORY_KEY);
        if (!raw) return [systemMessage];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [systemMessage];
        const withoutSystem = parsed.filter((item) => item?.role !== "system");
        return [systemMessage, ...withoutSystem];
    } catch {
        return [systemMessage];
    }
}

function saveChatHistory(history) {
    const trimmed = history.filter((item) => item?.role !== "system");
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
}

function renderChatHistory(history, chatLog) {
    if (!chatLog) return;
    chatLog.innerHTML = "";
    history.forEach((item) => {
        if (item.role === "system") return;
        const bubble = document.createElement("div");
        bubble.className = `llm-bubble llm-bubble--${item.role}`;
        if (item.role === "assistant") {
            bubble.innerHTML = renderMarkdown(item.content);
        } else {
            bubble.textContent = item.content;
        }
        chatLog.appendChild(bubble);
    });
    chatLog.scrollTop = chatLog.scrollHeight;
}

function clearChatHistoryInPlace(history, systemMessage) {
    localStorage.removeItem(CHAT_HISTORY_KEY);
    history.length = 0;
    history.push(systemMessage);
}

function renderMarkdown(text) {
    const cleaned = stripCommandBlocks(text);
    const escaped = escapeHtml(cleaned);
    const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return withBold.replace(/\n/g, "<br>");
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getStoredKey() {
    const key = localStorage.getItem(STORAGE_KEY);
    return key && key.trim().length > 0 ? key : null;
}















async function askOpenAI(apiKey, history, contextMessage) {
    const body = {
        model: MODEL_NAME,
        messages: contextMessage ? [...history, { role: "system", content: contextMessage }] : [...history],
        temperature: 0.3,
    };

    const response = await fetch(OPENAI_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message?.content;
    return message || "";
}







function getToolSpecs() {
    return [
        {
            name: "getState",
            description: "Get current state (left time, right time, sync camera, active filters, saved times).",
            input: {},
        },
        {
            name: "saveTimeLeft",
            description: "Save a time on the left panel. If timeKey omitted, uses current left time.",
            input: { timeKey: "optional time key string" },
        },
        {
            name: "setFilters",
            description: "Set category filters (isolation).",
            input: { categories: "array of category names" },
        },
        {
            name: "clearFilters",
            description: "Clear all filters (category + change).",
            input: {},
        },
        {
            name: "setCameraSync",
            description: "Enable/disable camera sync.",
            input: { enabled: "true/false" },
        },
        {
            name: "setTime",
            description: "Move time slider (left panel).",
            input: { timeKey: "time key string" },
        },
        {
            name: "readTimeLog",
            description: "Read TimeLog elements at a time key.",
            input: { timeKey: "time key string" },
        },
        {
            name: "readQuantityLog",
            description: "Read Quantity at a time key.",
            input: { timeKey: "time key string" },
        },
        {
            name: "readShapeLog",
            description: "Read ShapeLog metadata by element ids.",
            input: { elementIds: "array of element ids" },
        },
        {
            name: "getVisibleElements",
            description: "Get visible elements in the current panel (includes metadata).",
            input: { panel: "before|after" },
        },
        {
            name: "getVisibleByCategory",
            description: "Get visible elements in the current panel filtered by category.",
            input: { panel: "before|after", category: "category name" },
        },
        {
            name: "getVisibleStats",
            description: "Get counts by category from visible elements.",
            input: { panel: "before|after" },
        },
        {
            name: "compareVisibleStats",
            description: "Compare visible category counts between left/right panels.",
            input: {},
        },
        {
            name: "colorElements",
            description: "Color element ids with a given hex color.",
            input: { elementIds: "array of element ids", color: "#rrggbb" },
        },
        {
            name: "setChangeFilter",
            description: "Apply change filter: added, deleted, modified.",
            input: { changeType: "added|deleted|modified" },
        },
    ];
}