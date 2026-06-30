const BLOCKED_PATTERNS = [
  /terraform\s+destroy/i,
  /kubectl\s+delete\s+namespace/i,
  /git\s+reset\s+--hard/i,
  /git\s+push\s+origin\s+(main|master|dev)\b/i,
  /aws\s+iam\b/i
];

export function inspectPrompt(prompt) {
  const matches = [];

  for (const line of prompt.split(/\r?\n/)) {
    if (isSafetyInstruction(line)) {
      continue;
    }

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(line)) {
        matches.push(pattern.toString());
      }
    }
  }

  return {
    safe: matches.length === 0,
    matches: unique(matches)
  };
}

function isSafetyInstruction(line) {
  const value = line.toLowerCase();
  return value.includes("do not")
    || value.includes("don't")
    || value.includes("never")
    || value.includes("avoid")
    || value.includes("금지")
    || value.includes("사용하지")
    || value.includes("하지 마")
    || value.includes("하지마")
    || value.includes("말고");
}

function unique(values) {
  return [...new Set(values)];
}
