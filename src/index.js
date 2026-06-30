import path from "node:path";
import { config, validateConfig } from "./config.js";
import { SlackQueue } from "./slackQueue.js";
import { StateStore } from "./stateStore.js";
import { CodexExecutor } from "./codexExecutor.js";

validateConfig();

const state = new StateStore(path.resolve(config.stateDir));
const slackQueue = new SlackQueue(config);
const executor = new CodexExecutor({
  ...config,
  promptsDir: path.resolve(config.promptsDir),
  logsDir: path.resolve(config.logsDir)
});

async function tick() {
  const tasks = await slackQueue.fetchApprovedTasks({
    isProcessed: (taskKey) => state.isProcessed(taskKey)
  });

  for (const task of tasks) {
    await slackQueue.reply(
      task.slackTs,
      `Task \`${task.id}\` approved by ${task.approval.approvalCount}/${config.requiredApprovals}. Starting local runner.`
    );

    const result = await executor.execute(task);
    state.markProcessed(task.taskKey);

    await slackQueue.reply(
      task.slackTs,
      [
        result.ok ? "Codex runner completed." : "Codex runner failed.",
        result.summary,
        `Prompt: ${result.promptFile}`,
        `Log: ${result.logFile}`
      ].join("\n")
    );
  }
}

async function main() {
  console.log("TalkKing Codex runner started.");
  console.log(`Mode: ${config.codexExecutionMode}`);

  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error(error);
    }

    if (config.runOnce) {
      break;
    }

    await sleep(config.pollIntervalSeconds * 1000);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
