#!/usr/bin/env bun
/**
 * wrap-md.js — Wrap long lines in markdown files to stay under 100 bytes per line.
 *
 * Usage:
 *   bun scripts/wrap-md.js docs/FOR_ETHAN.md
 *   bun scripts/wrap-md.js docs/*.md
 *
 * Rules:
 *   - Lines inside code blocks (``` fences) are never wrapped
 *   - Table rows (starting with |) are never wrapped (would break markdown)
 *   - Headings (starting with #) are never wrapped
 *   - All other lines over 100 bytes are wrapped at the nearest word boundary
 *
 * Why bytes, not characters?
 *   awk and most linters count bytes, not JS string characters.
 *   Multi-byte chars like em-dashes (—) are 3 bytes but 1 JS char.
 *   Using Buffer.byteLength() keeps our count in sync with the linter.
 */

import { readFileSync, writeFileSync } from "fs";

const MAX_BYTES = 100;

// Count bytes (not JS characters) to match what linters see
function byteLen(str) {
  return Buffer.byteLength(str, "utf8");
}

// Wrap a single line to under MAX_BYTES, splitting at word boundaries
function wrapLine(line) {
  if (byteLen(line) <= MAX_BYTES) return [line];

  const words = line.split(" ");
  const outputLines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (byteLen(candidate) <= MAX_BYTES) {
      current = candidate;
    } else {
      if (current) outputLines.push(current);
      current = word;
    }
  }

  if (current) outputLines.push(current);
  return outputLines;
}

// Process a single file
function processFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const output = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Toggle code block tracking when we hit a fence
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      output.push(line);
      continue;
    }

    // Never touch lines inside code blocks, table rows, or headings
    const isProtected =
      inCodeBlock ||
      line.startsWith("|") ||
      line.startsWith("#");

    if (isProtected || byteLen(line) <= MAX_BYTES) {
      output.push(line);
    } else {
      // Wrap and push potentially multiple lines
      for (const wrapped of wrapLine(line)) {
        output.push(wrapped);
      }
    }
  }

  writeFileSync(filePath, output.join("\n"));

  // Report how many lines are still over limit (should only be tables/code)
  const remaining = output.filter(
    (l) => !l.startsWith("|") && byteLen(l) > MAX_BYTES
  ).length;

  console.log(`✓ ${filePath} — ${remaining} long non-table lines remaining`);
}

// Read file paths from CLI args
const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("Usage: bun scripts/wrap-md.js <file.md> [file.md ...]");
  process.exit(1);
}

for (const file of files) {
  processFile(file);
}
