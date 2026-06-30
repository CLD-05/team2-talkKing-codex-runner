import assert from "node:assert/strict";
import test from "node:test";
import { SlackQueue } from "../src/slackQueue.js";

const config = {
  slackBotToken: "test-token",
  slackChannelId: "C123",
  approvalEmoji: "white_check_mark",
  rejectEmoji: "x",
  requiredApprovals: 2,
  approverUserIds: []
};

function taskMessage({ ts, approvalCount = 0, rejectCount = 0 }) {
  const reactions = [];
  if (approvalCount > 0) {
    reactions.push({ name: "white_check_mark", count: approvalCount });
  }
  if (rejectCount > 0) {
    reactions.push({ name: "x", count: rejectCount });
  }

  return {
    ts,
    text: `[CODEX_TASK]\nid: task-${ts}\ntitle: Test\nseverity: info\nprompt:\nDo work`,
    reactions
  };
}

test("queries reaction details only for actionable unprocessed tasks", async () => {
  const queue = new SlackQueue(config);
  const reactionCalls = [];
  queue.client = {
    conversations: {
      history: async () => ({
        messages: [
          taskMessage({ ts: "processed", approvalCount: 2 }),
          taskMessage({ ts: "pending", approvalCount: 1 }),
          taskMessage({ ts: "approved", approvalCount: 2 })
        ]
      })
    },
    reactions: {
      get: async ({ timestamp }) => {
        reactionCalls.push(timestamp);
        return {
          message: {
            reactions: [{ name: "white_check_mark", count: 2, users: ["U1", "U2"] }]
          }
        };
      }
    }
  };

  const tasks = await queue.fetchApprovedTasks({
    isProcessed: (taskKey) => taskKey.endsWith(":processed")
  });

  assert.deepEqual(reactionCalls, ["approved"]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].slackTs, "approved");
});

test("does not query Slack again until the reaction counts change", async () => {
  const queue = new SlackQueue(config);
  let approvalCount = 2;
  let reactionCalls = 0;
  queue.client = {
    conversations: {
      history: async () => ({ messages: [taskMessage({ ts: "task", approvalCount })] })
    },
    reactions: {
      get: async () => {
        reactionCalls += 1;
        return {
          message: {
            reactions: [{
              name: "white_check_mark",
              count: approvalCount,
              users: approvalCount === 2 ? ["U1", "U2"] : ["U1", "U2", "U3"]
            }]
          }
        };
      }
    }
  };

  await queue.fetchApprovedTasks();
  await queue.fetchApprovedTasks();
  approvalCount = 3;
  await queue.fetchApprovedTasks();

  assert.equal(reactionCalls, 2);
});
