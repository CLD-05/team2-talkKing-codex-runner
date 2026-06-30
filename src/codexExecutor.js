import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { inspectPrompt } from "./safetyGuard.js";

export class CodexExecutor {
  constructor(config) {
    this.config = config;
  }

  ensureDirs() {
    fs.mkdirSync(this.config.promptsDir, { recursive: true });
    fs.mkdirSync(this.config.logsDir, { recursive: true });
  }

  async execute(task) {
    this.ensureDirs();

    const promptFile = path.resolve(this.config.promptsDir, `${task.id}.md`);
    const logFile = path.resolve(this.config.logsDir, `${task.id}.log`);
    fs.writeFileSync(promptFile, task.prompt, "utf8");

    const safety = inspectPrompt(task.prompt);
    if (!safety.safe) {
      const message = `Blocked by safety guard: ${safety.matches.join(", ")}`;
      fs.writeFileSync(logFile, message, "utf8");
      return { ok: false, promptFile, logFile, summary: message };
    }

    if (this.config.codexExecutionMode !== "execute") {
      const summary = `Dry-run complete. Prompt written to ${promptFile}`;
      fs.writeFileSync(logFile, summary, "utf8");
      return { ok: true, promptFile, logFile, summary };
    }

    if (!this.config.codexArgsTemplate) {
      const message = "CODEX_ARGS_TEMPLATE is empty. Refusing to execute.";
      fs.writeFileSync(logFile, message, "utf8");
      return { ok: false, promptFile, logFile, summary: message };
    }

    const args = renderArgs(this.config.codexArgsTemplate, { promptFile });
    return this.runCommand(args, logFile, promptFile, task.prompt);
  }

  runCommand(args, logFile, promptFile, prompt) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      let child;
      try {
        const spawnSpec = getSpawnSpec(this.config.codexCommand, args);
        child = spawn(spawnSpec.command, spawnSpec.args, {
          cwd: this.config.workspaceRoot,
          shell: false
        });
      } catch (error) {
        return finish(this.writeStartFailure(error, logFile, promptFile));
      }

      const chunks = [];
      child.stdout.on("data", (data) => chunks.push(data));
      child.stderr.on("data", (data) => chunks.push(data));

      if (args.includes("-") && child.stdin.writable) {
        child.stdin.end(prompt);
      }

      child.on("error", (error) => {
        finish(this.writeStartFailure(error, logFile, promptFile));
      });

      child.on("close", (code) => {
        const output = Buffer.concat(chunks).toString("utf8");
        fs.writeFileSync(logFile, output, "utf8");
        finish({
          ok: code === 0,
          promptFile,
          logFile,
          summary: code === 0 ? "Codex execution completed." : `Codex execution failed with exit code ${code}.`
        });
      });
    });
  }

  writeStartFailure(error, logFile, promptFile) {
    const message = [
      `Failed to start Codex command: ${this.config.codexCommand}`,
      `Error: ${error.message}`,
      "Check CODEX_COMMAND and CODEX_ARGS_TEMPLATE in .env."
    ].join("\n");
    fs.writeFileSync(logFile, message, "utf8");
    return {
      ok: false,
      promptFile,
      logFile,
      summary: message
    };
  }
}

function renderArgs(template, values) {
  return splitArgs(template.replaceAll("{{promptFile}}", values.promptFile));
}

function splitArgs(value) {
  return value.match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
}

function getSpawnSpec(command, args) {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args };
  }

  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", quoteWindowsCommand([command, ...args])]
  };
}

function quoteWindowsCommand(parts) {
  return parts.map(quoteWindowsArg).join(" ");
}

function quoteWindowsArg(value) {
  if (!/[ \t"&|<>^]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}
