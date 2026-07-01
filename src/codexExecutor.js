import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { inspectPrompt } from "./safetyGuard.js";
// 💡 다른 로직은 유지하고 AWS S3 SDK만 상단에 추가합니다.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// S3 클라이언트 초기화 (자격 증명은 환경변수나 IAM Role을 통해 자동 주입)
const s3Client = new S3Client({ region: "ap-northeast-2" });
const BUCKET_NAME = "team2-logs-bucket"; // 💡 실제 사용하시는 S3 버킷명으로 변경하세요.

export class CodexExecutor {
  constructor(config) {
    this.config = config;
  }

  ensureDirs() {
    fs.mkdirSync(this.config.promptsDir, { recursive: true });
    fs.mkdirSync(this.config.logsDir, { recursive: true });
  }

  // 💡 S3로 로그를 밀어 넣는 헬퍼 메서드 추가 (다른 로직에 영향 없음)
  async uploadToS3(logFile) {
    try {
      if (!fs.existsSync(logFile)) return;
      
      const fileName = path.basename(logFile);
      const today = new Date().toISOString().split('T')[0];
      const s3Key = `logs/${today}/${fileName}`;
      const fileBuffer = fs.readFileSync(logFile);

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: "text/plain",
        ServerSideEncryption: "AES256",
      });

      await s3Client.send(command);
    } catch (error) {
      console.error(`[AWS S3 업로드 실패] 파일명: ${logFile}, 에러:`, error.message);
    }
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
      
      // 💡 안전성 검사에 걸려 로그가 기록된 즉시 S3 업로드 실행
      this.uploadToS3(logFile);
      return { ok: false, promptFile, logFile, summary: message };
    }

    if (this.config.codexExecutionMode !== "execute") {
      const summary = `Dry-run complete. Prompt written to ${promptFile}`;
      fs.writeFileSync(logFile, summary, "utf8");
      
      // 💡 드라이런 로그 기록 직후 S3 업로드 실행
      this.uploadToS3(logFile);
      return { ok: true, promptFile, logFile, summary };
    }

    if (!this.config.codexArgsTemplate) {
      const message = "CODEX_ARGS_TEMPLATE is empty. Refusing to execute.";
      fs.writeFileSync(logFile, message, "utf8");
      
      // 💡 실행 거부 로그 기록 직후 S3 업로드 실행
      this.uploadToS3(logFile);
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
        const result = this.writeStartFailure(error, logFile, promptFile);
        // 💡 커맨드 시작 실패 로그 기록 즉시 S3 업로드 실행
        this.uploadToS3(logFile);
        return finish(result);
      }

      const chunks = [];
      child.stdout.on("data", (data) => chunks.push(data));
      child.stderr.on("data", (data) => chunks.push(data));

      if (args.includes("-") && child.stdin.writable) {
        child.stdin.end(prompt);
      }

      child.on("error", (error) => {
        const result = this.writeStartFailure(error, logFile, promptFile);
        // 💡 자식 프로세스 에러 발생 시 S3 업로드 실행
        this.uploadToS3(logFile);
        return finish(result);
      });

      child.on("close", (code) => {
        const output = Buffer.concat(chunks).toString("utf8");
        fs.writeFileSync(logFile, output, "utf8");
        
        // 💡 정상 혹은 비정상 종료로 최종 로그 출력이 완려된 후 S3 업로드 실행
        this.uploadToS3(logFile);
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
