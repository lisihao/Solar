/**
 * Auto-version & changelog generator
 *
 * Runs before every build (dev/build). Reads git log for commits after the last
 * released version, auto-bumps version (minor for feat, patch for fix), updates:
 *   - frontend/CHANGELOG.md
 *   - frontend/lib/generated/changelog.json
 *   - package.json, backend/package.json, frontend/package.json
 *
 * If no new conventional commits exist, skips bumping and just regenerates JSON.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Paths ──────────────────────────────────────────────────────────────────
const frontendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(frontendDir, '..');
const changelogPath = path.join(frontendDir, 'lib/generated/CHANGELOG.md');
const outputPath = path.join(frontendDir, 'lib/generated/changelog.json');

// Detect Docker build: frontend is at /app, root package.json won't exist
const isDockerBuild = !fs.existsSync(path.join(rootDir, 'package.json'));

const packagePaths = isDockerBuild
  ? [path.join(frontendDir, 'package.json')]
  : [
      path.join(rootDir, 'package.json'),
      path.join(rootDir, 'backend/package.json'),
      path.join(rootDir, 'frontend/package.json'),
    ];

// ── Helpers ────────────────────────────────────────────────────────────────
function git(cmd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Step 1: Read current version from package.json ─────────────────────────
const rootPkg = JSON.parse(fs.readFileSync(packagePaths[0], 'utf-8'));
const currentVersion = rootPkg.version; // e.g. "3.71.0"
console.log(
  `Current version: ${currentVersion}${isDockerBuild ? ' (Docker build)' : ''}`
);

// ── Step 2: Find the base commit for current version ───────────────────────
// Strategy: try release commit first, then tag, then auto-bump commit
let baseCommit = git(
  `log --all --format=%H --grep="chore(release): ${currentVersion}" -1`
);
if (!baseCommit) {
  baseCommit = git(`rev-list -1 v${currentVersion}`);
}
if (!baseCommit) {
  // Fallback: find auto-bump commit (this script's own commits)
  baseCommit = git(
    `log --all --format=%H --grep="chore(auto-release): ${currentVersion}" -1`
  );
}
if (!baseCommit) {
  // Fallback: find manual bump commit (e.g. "chore: bump version to 3.72.0 with changelog")
  baseCommit = git(
    `log --all --format=%H --grep="bump version to ${currentVersion}" -1`
  );
}

// Fallback: find the most recent release/bump commit of ANY version
if (!baseCommit) {
  baseCommit = git(`log --all --format=%H --grep="chore(release):" -1`);
  if (baseCommit) {
    console.log(`Using latest release commit as fallback base`);
  }
}
if (!baseCommit) {
  baseCommit = git(`log --all --format=%H --grep="bump version to" -1`);
  if (baseCommit) {
    console.log(`Using latest bump commit as fallback base`);
  }
}

// ── Step 3: Get new conventional commits since last release ────────────────
let newCommits = [];
if (baseCommit) {
  const raw = git(`log --format=%s ${baseCommit}..HEAD`);
  if (raw) newCommits = raw.split('\n').filter(Boolean);
} else {
  console.log('No base commit found for current version, skipping auto-bump');
}

// Parse conventional commits: type(scope): description
const conventionalRegex =
  /^(feat|fix|refactor|perf|docs|style|test|chore|ci|build)(\([^)]+\))?!?:\s*(.+)$/;
const visibleTypes = new Set(['feat', 'fix', 'refactor', 'perf']);
const typeToSection = {
  feat: 'Features',
  fix: 'Bug Fixes',
  refactor: 'Refactoring',
  perf: 'Performance',
};
const typeToChangeType = {
  feat: 'feature',
  fix: 'fix',
  refactor: 'improvement',
  perf: 'improvement',
};

const parsed = [];
let hasFeat = false;
let hasFix = false;

for (const msg of newCommits) {
  const m = msg.match(conventionalRegex);
  if (!m) continue;
  const [, type, scopeRaw, description] = m;
  if (!visibleTypes.has(type)) continue;
  const scope = scopeRaw ? scopeRaw.slice(1, -1) : null;
  parsed.push({ type, scope, description });
  if (type === 'feat') hasFeat = true;
  if (type === 'fix') hasFix = true;
}

// ── Step 4: Bump version if needed ─────────────────────────────────────────
let newVersion = currentVersion;

if (parsed.length > 0) {
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  if (hasFeat) {
    newVersion = `${major}.${minor + 1}.0`;
  } else {
    newVersion = `${major}.${minor}.${patch + 1}`;
  }
  console.log(
    `Auto-bump: ${currentVersion} → ${newVersion} (${parsed.length} changes: ${hasFeat ? 'minor' : 'patch'})`
  );

  // Update all package.json files
  for (const pkgPath of packagePaths) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      pkg.version = newVersion;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    } catch {
      // Skip if file doesn't exist (e.g. in partial checkout)
    }
  }

  // Build CHANGELOG.md entry
  const sections = {};
  for (const { type, scope, description } of parsed) {
    const section = typeToSection[type];
    if (!sections[section]) sections[section] = [];
    const prefix = scope ? `**${scope}:** ` : '';
    sections[section].push(`* ${prefix}${description}`);
  }

  let entry = `\n## ${newVersion} (${today()})\n`;
  for (const [section, items] of Object.entries(sections)) {
    entry += `\n\n### ${section}\n\n`;
    entry += items.join('\n');
  }
  entry += '\n';

  // Prepend to CHANGELOG.md (after header)
  const changelog = fs.readFileSync(changelogPath, 'utf-8');
  const headerEnd = changelog.indexOf('\n## ');
  if (headerEnd !== -1) {
    const header = changelog.slice(0, headerEnd);
    const rest = changelog.slice(headerEnd);
    fs.writeFileSync(changelogPath, header + '\n' + entry + rest);
  } else {
    // No existing versions, append after header
    fs.writeFileSync(changelogPath, changelog + '\n' + entry);
  }

  console.log(`Updated CHANGELOG.md and package.json files`);
} else {
  console.log('No new conventional commits, skipping version bump');
}

// ── Step 5: Parse CHANGELOG.md → changelog.json (existing logic) ───────────
// PR-X35 untracked CHANGELOG.md (4.5MB build artifact). It is generated by
// step 4 above only when there are new conventional commits. In Docker
// builds and fresh clones the file may not exist yet — in that case skip
// regenerating changelog.json and trust the version already committed at
// frontend/lib/generated/changelog.json (which IS tracked).
if (!fs.existsSync(changelogPath)) {
  console.log(
    `No CHANGELOG.md at ${changelogPath} — keeping existing changelog.json untouched.`
  );
  process.exit(0);
}
const content = fs.readFileSync(changelogPath, 'utf-8');

const versionRegex =
  /^#{1,3}\s+\[?(\d+\.\d+\.\d+)\]?(?:\([^)]*\))?\s+\((\d{4}-\d{2}-\d{2})\)/gm;

const sectionTypeMap = {
  features: 'feature',
  'bug fixes': 'fix',
  refactoring: 'improvement',
  performance: 'improvement',
  'performance improvements': 'improvement',
  'breaking changes': 'breaking',
};

const entries = [];
const matches = [];

let match;
while ((match = versionRegex.exec(content)) !== null) {
  matches.push({ version: match[1], date: match[2], index: match.index });
}

for (let i = 0; i < matches.length; i++) {
  const { version, date, index } = matches[i];
  const nextIndex =
    i + 1 < matches.length ? matches[i + 1].index : content.length;
  const block = content.slice(index, nextIndex);

  const changes = [];

  const sectionRegex = /^### (.+)$/gm;
  let secMatch;
  const sections2 = [];
  while ((secMatch = sectionRegex.exec(block)) !== null) {
    if (secMatch[1].startsWith('[') || /^\d/.test(secMatch[1])) continue;
    sections2.push({ name: secMatch[1].trim(), index: secMatch.index });
  }

  for (let j = 0; j < sections2.length; j++) {
    const secEnd =
      j + 1 < sections2.length ? sections2[j + 1].index : block.length;
    const secBlock = block.slice(sections2[j].index, secEnd);
    const type =
      sectionTypeMap[sections2[j].name.toLowerCase()] || 'improvement';

    const itemRegex = /^[*-]\s+(.+)$/gm;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(secBlock)) !== null) {
      let raw = itemMatch[1];
      const scopeMatch2 = raw.match(/^\*\*([^*:]+):?\*\*:?\s*/);
      if (scopeMatch2) raw = raw.slice(scopeMatch2[0].length);
      let desc = raw
        .replace(/\s*\(\[[a-f0-9]+\]\([^)]*\)\)\s*$/, '')
        .replace(/\s*\([a-f0-9]{7,}\)\s*$/, '')
        .trim();
      if (desc) {
        changes.push({ type, description: desc });
      }
    }
  }

  if (changes.length === 0) continue;
  entries.push({ version, date, changes });
}

// Deduplicate
for (let i = 0; i < entries.length - 1; i++) {
  const olderDescs = new Set(entries[i + 1].changes.map((c) => c.description));
  entries[i].changes = entries[i].changes.filter(
    (c) => !olderDescs.has(c.description)
  );
}

const dedupedEntries = entries.filter((e) => e.changes.length > 0);

// Consolidate patch versions
const consolidated = [];
const minorMap = new Map();

for (const entry of [...dedupedEntries].reverse()) {
  const [major, minor, patch] = entry.version.split('.').map(Number);
  const minorKey = `${major}.${minor}`;

  if (patch === 0) {
    const existingIdx = minorMap.get(minorKey);
    if (existingIdx !== undefined) {
      const existingDescs = new Set(
        consolidated[existingIdx].changes.map((c) => c.description)
      );
      const newChanges = entry.changes.filter(
        (c) => !existingDescs.has(c.description)
      );
      consolidated[existingIdx].changes = [
        ...newChanges,
        ...consolidated[existingIdx].changes,
      ];
    } else {
      minorMap.set(minorKey, consolidated.length);
      consolidated.push(entry);
    }
  } else {
    const existingIdx = minorMap.get(minorKey);
    if (existingIdx !== undefined) {
      const existingDescs = new Set(
        consolidated[existingIdx].changes.map((c) => c.description)
      );
      for (const change of entry.changes) {
        if (!existingDescs.has(change.description)) {
          consolidated[existingIdx].changes.push(change);
        }
      }
      if (entry.date > consolidated[existingIdx].date) {
        consolidated[existingIdx].date = entry.date;
      }
    } else {
      minorMap.set(minorKey, consolidated.length);
      consolidated.push({
        version: `${major}.${minor}.0`,
        date: entry.date,
        changes: [...entry.changes],
      });
    }
  }
}

consolidated.reverse();

// Write changelog.json
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(consolidated, null, 2));
console.log(
  `Generated changelog.json with ${consolidated.length} versions (${entries.length - consolidated.length} consolidated/removed)`
);
