import { WebClient } from "@slack/web-api";
import { parseTask } from "./taskParser.js";

export class SlackQueue {
  constructor(config) {
    this.config = config;
    this.client = new WebClient(config.slackBotToken);
    this.reactionStateCache = new Map();
  }

  async fetchApprovedTasks({ isProcessed = () => false } = {}) {
    const history = await this.client.conversations.history({
      channel: this.config.slackChannelId,
      limit: this.config.taskLookbackLimit
    });

    const messages = history.messages ?? [];
    const approvedTasks = [];

    for (const message of messages) {
      const task = parseTask({ ...message, channel: this.config.slackChannelId });
      if (!task) {
        continue;
      }

      if (isProcessed(task.taskKey)) {
        continue;
      }

      const reactionSummary = this.getRelevantReactionSummary(message.reactions ?? []);
      const previousSignature = this.reactionStateCache.get(message.ts);
      if (previousSignature === reactionSummary.signature) {
        continue;
      }

      if (!reactionSummary.actionable) {
        this.reactionStateCache.set(message.ts, reactionSummary.signature);
        continue;
      }

      const approval = await this.getApprovalState(message.ts);
      this.reactionStateCache.set(message.ts, reactionSummary.signature);
      if (approval.rejected) {
        continue;
      }

      if (approval.approvalCount >= this.config.requiredApprovals) {
        approvedTasks.push({ ...task, prompt: await this.resolvePrompt(task), approval });
      }
    }

    return approvedTasks;
  }

  getRelevantReactionSummary(reactions) {
    const approvalCount = this.getReactionCount(reactions, this.config.approvalEmoji);
    const rejectCount = this.getReactionCount(reactions, this.config.rejectEmoji);

    return {
      approvalCount,
      rejectCount,
      actionable: rejectCount > 0 || approvalCount >= this.config.requiredApprovals,
      signature: `${approvalCount}:${rejectCount}`
    };
  }

  async resolvePrompt(task) {
    if (task.prompt && task.prompt.trim()) {
      return task.prompt;
    }

    if (!task.promptFile) {
      return "";
    }

    const promptFile = await this.getPromptFileInfo(task.promptFile);
    const downloadUrl = promptFile.url_private_download ?? promptFile.url_private;
    if (!downloadUrl) {
      return "";
    }

    const response = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${this.config.slackBotToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download prompt file: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    if (looksLikeSlackHtml(body, contentType)) {
      throw new Error(
        "Downloaded Slack HTML instead of the prompt file. Check that the bot token has files:read scope, the app was reinstalled, and SLACK_BOT_TOKEN belongs to that app."
      );
    }

    return body;
  }

  async getPromptFileInfo(file) {
    if (!file.id) {
      return file;
    }

    try {
      const response = await this.client.files.info({ file: file.id });
      return response.file ?? file;
    } catch (error) {
      if (file.url_private_download || file.url_private) {
        return file;
      }
      throw error;
    }
  }

  async getApprovalState(timestamp) {
    const response = await this.client.reactions.get({
      channel: this.config.slackChannelId,
      timestamp,
      full: true
    });

    const reactions = response.message?.reactions ?? [];
    const approvalUsers = this.getReactionUsers(reactions, this.config.approvalEmoji);
    const rejectUsers = this.getReactionUsers(reactions, this.config.rejectEmoji);
    const allowedApprovers = new Set(this.config.approverUserIds);

    const filteredApprovers = this.config.approverUserIds.length > 0
      ? approvalUsers.filter((user) => allowedApprovers.has(user))
      : approvalUsers;

    return {
      approvalUsers: unique(filteredApprovers),
      approvalCount: unique(filteredApprovers).length,
      rejectUsers: unique(rejectUsers),
      rejectCount: unique(rejectUsers).length,
      rejected: rejectUsers.length > 0
    };
  }

  getReactionUsers(reactions, name) {
    return reactions.find((reaction) => reaction.name === name)?.users ?? [];
  }

  getReactionCount(reactions, name) {
    return reactions.find((reaction) => reaction.name === name)?.count ?? 0;
  }

  async reply(threadTs, text) {
    await this.client.chat.postMessage({
      channel: this.config.slackChannelId,
      thread_ts: threadTs,
      text
    });
  }
}

function unique(values) {
  return [...new Set(values)];
}

function looksLikeSlackHtml(body, contentType) {
  const trimmed = body.trimStart().toLowerCase();
  return contentType.includes("text/html")
    || trimmed.startsWith("<!doctype html")
    || trimmed.startsWith("<html")
    || trimmed.includes("<title>slack");
}
