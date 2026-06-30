const TASK_MARKER = "[CODEX_TASK]";

export function parseTask(message) {
  const text = message.text ?? "";
  if (!text.includes(TASK_MARKER)) {
    return null;
  }

  const id = matchLine(text, "id") ?? message.ts;
  const title = matchLine(text, "title") ?? "Untitled Codex task";
  const severity = matchLine(text, "severity") ?? "unknown";
  const prompt = extractPrompt(text);
  const promptFile = findPromptFile(message.files ?? []);

  if (!prompt && !promptFile) {
    return null;
  }

  return {
    id: sanitizeId(id),
    title,
    severity,
    prompt,
    promptFile,
    slackTs: message.ts,
    taskKey: `${message.channel ?? "channel"}:${message.ts}`
  };
}

function matchLine(text, key) {
  const regex = new RegExp(`^${key}\\s*:\\s*(.+)$`, "im");
  return text.match(regex)?.[1]?.trim();
}

function extractPrompt(text) {
  const match = text.match(/^prompt\s*:\s*$/im);
  if (!match || match.index == null) {
    return "";
  }
  return text.slice(match.index + match[0].length).trim();
}

function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

function findPromptFile(files) {
  return files.find((file) => {
    const name = file.name ?? file.title ?? "";
    return name.toLowerCase().endsWith(".txt") || name.toLowerCase().includes("prompt");
  }) ?? null;
}
