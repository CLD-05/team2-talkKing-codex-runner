import fs from "node:fs";
import path from "node:path";

export class StateStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.filePath = path.join(rootDir, "processed.json");
  }

  ensure() {
    fs.mkdirSync(this.rootDir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ processed: [] }, null, 2));
    }
  }

  load() {
    this.ensure();
    return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
  }

  isProcessed(taskKey) {
    const state = this.load();
    return state.processed.includes(taskKey);
  }

  markProcessed(taskKey) {
    const state = this.load();
    if (!state.processed.includes(taskKey)) {
      state.processed.push(taskKey);
    }
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }
}
