#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const EDIT_TOOL_NAMES = new Set([
  "apply_patch",
  "create_file",
  "replace_string_in_file",
  "editFiles",
  "writeFile",
  "createFile"
]);

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

function output(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isMarkdownFile(filePath) {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolveExistingFile(filePath) {
  if (!filePath || !isMarkdownFile(filePath)) {
    return null;
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  return fs.existsSync(resolvedPath) ? resolvedPath : null;
}

function collectFromPatch(patchText) {
  const files = [];
  const pattern = /^\*\*\* (?:Add|Update) File: (.+)$/gm;
  let match = pattern.exec(patchText);

  while (match) {
    files.push(match[1].trim());
    match = pattern.exec(patchText);
  }

  return files;
}

function collectCandidateFiles(input) {
  const candidates = [];

  if (!input || typeof input !== "object") {
    return candidates;
  }

  if (typeof input.filePath === "string") {
    candidates.push(input.filePath);
  }

  if (Array.isArray(input.filePaths)) {
    candidates.push(...input.filePaths.filter((value) => typeof value === "string"));
  }

  if (Array.isArray(input.files)) {
    candidates.push(...input.files.filter((value) => typeof value === "string"));
  }

  if (typeof input.input === "string") {
    candidates.push(...collectFromPatch(input.input));
  }

  const envPath = process.env.TOOL_INPUT_FILE_PATH;
  if (typeof envPath === "string" && envPath.length > 0) {
    candidates.push(envPath);
  }

  return [...new Set(candidates)]
    .map(resolveExistingFile)
    .filter(Boolean);
}

function runMarkdownlint(filePath) {
  return spawnSync("markdownlint", ["-f", filePath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

const rawInput = fs.readFileSync(0, "utf8");
const payload = safeJsonParse(rawInput) || {};
const toolName = payload.tool_name || payload.toolName || "";
const toolInput = payload.tool_input || payload.toolInput || {};

if (!EDIT_TOOL_NAMES.has(toolName)) {
  output({ continue: true });
  process.exit(0);
}

const markdownFiles = collectCandidateFiles(toolInput);

if (markdownFiles.length === 0) {
  output({ continue: true });
  process.exit(0);
}

const failures = [];

for (const filePath of markdownFiles) {
  const result = runMarkdownlint(filePath);
  if (result.status !== 0) {
    failures.push({
      filePath,
      stderr: (result.stderr || "").trim(),
      stdout: (result.stdout || "").trim()
    });
  }
}

if (failures.length > 0) {
  const summary = failures
    .map(({ filePath, stderr, stdout }) => `${path.relative(process.cwd(), filePath)}: ${stderr || stdout || "markdownlint failed"}`)
    .join("\n");

  output({
    continue: true,
    systemMessage: `markdownlint -f reported issues after Markdown edit:\n${summary}`,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `markdownlint -f reported issues after Markdown edit:\n${summary}`
    }
  });
  process.exit(0);
}

output({ continue: true });