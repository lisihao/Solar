#!/usr/bin/env tsx
/**
 * Sync CHANGELOG.md entries to GitHub Releases
 * Usage: tsx scripts/devops/sync-github-releases.ts [--dry-run] [--latest N]
 */

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const latestIdx = args.indexOf("--latest");
const latestN = latestIdx >= 0 ? parseInt(args[latestIdx + 1], 10) : 5;

const rootDir = resolve(__dirname, "../..");
const changelogPath = resolve(rootDir, "CHANGELOG.md");

interface VersionEntry {
  version: string;
  date: string;
  body: string;
}

function parseChangelog(content: string): VersionEntry[] {
  const entries: VersionEntry[] = [];
  const versionRegex =
    /^###?\s+\[(\d+\.\d+\.\d+)\].*?\((\d{4}-\d{2}-\d{2})\)/gm;

  let match: RegExpExecArray | null;
  const matches: { version: string; date: string; index: number }[] = [];

  while ((match = versionRegex.exec(content)) !== null) {
    matches.push({ version: match[1], date: match[2], index: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const body = content
      .slice(start, end)
      .replace(/^###?\s+\[.*?\n/, "")
      .trim();
    entries.push({
      version: matches[i].version,
      date: matches[i].date,
      body,
    });
  }

  return entries;
}

function getExistingReleases(): Set<string> {
  try {
    const output = execSync("gh release list --limit 100 --json tagName", {
      encoding: "utf-8",
      cwd: rootDir,
    });
    const releases = JSON.parse(output) as { tagName: string }[];
    return new Set(releases.map((r) => r.tagName));
  } catch {
    console.error("Failed to list releases. Is gh CLI authenticated?");
    return new Set();
  }
}

function getExistingTags(): Set<string> {
  try {
    const output = execSync('git tag --list "v*"', {
      encoding: "utf-8",
      cwd: rootDir,
    });
    return new Set(output.trim().split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

function createRelease(entry: VersionEntry): void {
  const tag = `v${entry.version}`;
  const title = `v${entry.version} (${entry.date})`;
  const cmd = `gh release create ${tag} --title "${title}" --notes "${entry.body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

  if (dryRun) {
    console.log(`[DRY RUN] Would create release: ${tag}`);
    console.log(`  Title: ${title}`);
    console.log(`  Body: ${entry.body.slice(0, 100)}...`);
    return;
  }

  try {
    execSync(cmd, { encoding: "utf-8", cwd: rootDir, stdio: "pipe" });
    console.log(`Created release: ${tag}`);
  } catch (err) {
    console.error(`Failed to create release ${tag}:`, (err as Error).message);
  }
}

// Main
const changelog = readFileSync(changelogPath, "utf-8");
const entries = parseChangelog(changelog).slice(0, latestN);
const existingReleases = getExistingReleases();
const existingTags = getExistingTags();

console.log(
  `Found ${entries.length} changelog entries (showing latest ${latestN})`,
);
console.log(`Existing GitHub releases: ${existingReleases.size}`);

let created = 0;
for (const entry of entries) {
  const tag = `v${entry.version}`;
  if (existingReleases.has(tag)) {
    console.log(`  Skip ${tag} (release exists)`);
    continue;
  }
  if (!existingTags.has(tag)) {
    console.log(`  Skip ${tag} (no git tag)`);
    continue;
  }
  createRelease(entry);
  created++;
}

console.log(
  `\nDone. ${dryRun ? "Would create" : "Created"} ${created} releases.`,
);
