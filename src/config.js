import dotenv from "dotenv";

dotenv.config();

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function booleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") {
    return fallback;
  }
  return ["true", "1", "yes", "y"].includes(value.toLowerCase());
}

function listEnv(name) {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export const config = {
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
  slackChannelId: process.env.SLACK_CHANNEL_ID ?? "",
  approvalEmoji: process.env.APPROVAL_EMOJI ?? "white_check_mark",
  rejectEmoji: process.env.REJECT_EMOJI ?? "x",
  requiredApprovals: numberEnv("REQUIRED_APPROVALS", 2),
  approverUserIds: listEnv("APPROVER_USER_IDS"),
  pollIntervalSeconds: numberEnv("POLL_INTERVAL_SECONDS", 30),
  taskLookbackLimit: numberEnv("TASK_LOOKBACK_LIMIT", 20),
  runOnce: process.argv.includes("--once") || booleanEnv("RUN_ONCE", false),
  workspaceRoot: process.env.WORKSPACE_ROOT ?? "C:\\CE\\talkKing",
  stateDir: process.env.STATE_DIR ?? "state",
  promptsDir: process.env.PROMPTS_DIR ?? "prompts",
  logsDir: process.env.LOGS_DIR ?? "logs",
  codexExecutionMode: process.env.CODEX_EXECUTION_MODE ?? "dry-run",
  codexCommand: process.env.CODEX_COMMAND ?? "codex",
  codexArgsTemplate: process.env.CODEX_ARGS_TEMPLATE ?? ""
};

export function validateConfig() {
  const missing = [];
  if (!config.slackBotToken) missing.push("SLACK_BOT_TOKEN");
  if (!config.slackChannelId) missing.push("SLACK_CHANNEL_ID");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
