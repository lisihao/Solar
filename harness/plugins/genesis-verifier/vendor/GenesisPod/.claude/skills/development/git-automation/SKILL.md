---
name: Git Automation
description: Automate Git workflows including branching, commits, PRs, and conflict resolution
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
tags:
  - git
  - automation
  - workflow
  - github
---

# Git Automation Expert

You are an expert at automating Git workflows for GenesisPod.

## Git Workflow

```
main
  │
  ├──► feat/feature-name ──► PR ──► merge
  │
  ├──► fix/bug-description ──► PR ──► merge
  │
  └──► refactor/area ──► PR ──► merge
```

## Branch Naming Convention

| Type     | Pattern             | Example                     |
| -------- | ------------------- | --------------------------- |
| Feature  | `feat/<name>`       | `feat/ai-writing-outline`   |
| Bug Fix  | `fix/<description>` | `fix/login-session-timeout` |
| Refactor | `refactor/<area>`   | `refactor/auth-module`      |
| Docs     | `docs/<topic>`      | `docs/api-reference`        |
| Chore    | `chore/<task>`      | `chore/update-deps`         |

## Commit Message Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Types

| Type     | Description             |
| -------- | ----------------------- |
| feat     | New feature             |
| fix      | Bug fix                 |
| refactor | Code refactoring        |
| docs     | Documentation           |
| style    | Code style (formatting) |
| test     | Tests                   |
| chore    | Maintenance             |

### Examples

```bash
# Feature
git commit -m "feat(ai-writing): add outline generation"

# Bug fix
git commit -m "fix(auth): resolve session timeout issue"

# Refactor
git commit -m "refactor(api): consolidate error handling"
```

## Common Operations

### Create Feature Branch

```bash
# Ensure main is up to date
git checkout main
git pull origin main

# Create and switch to feature branch
git checkout -b feat/my-feature
```

### Stage and Commit

```bash
# Check status
git status

# Stage specific files
git add src/feature.ts

# Stage all changes
git add .

# Commit with message
git commit -m "feat(module): description"
```

### Push and Create PR

```bash
# Push branch
git push -u origin feat/my-feature

# Create PR with gh CLI
gh pr create --title "feat(module): title" --body "$(cat <<'EOF'
## Summary
- Change 1
- Change 2

## Test Plan
- [ ] Tested locally
- [ ] Tests pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Sync with Main

```bash
# Fetch latest changes
git fetch origin

# Rebase on main
git rebase origin/main

# Or merge main
git merge origin/main
```

### Resolve Conflicts

```bash
# After conflict during rebase/merge
# 1. Edit conflicted files
# 2. Stage resolved files
git add <resolved-file>

# 3. Continue rebase
git rebase --continue

# Or for merge
git commit -m "Merge main into feature"
```

### Undo Operations

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Undo specific file change
git checkout -- <file>

# Revert a pushed commit
git revert <commit-hash>
```

## GitHub CLI Commands

```bash
# List PRs
gh pr list

# View PR details
gh pr view <number>

# Check PR status
gh pr checks <number>

# Merge PR
gh pr merge <number> --squash

# Create issue
gh issue create --title "Bug: description" --body "Details"

# Close issue
gh issue close <number>
```

## Safety Rules

### NEVER Do

- `git push --force` to main/master
- `git reset --hard` on shared branches
- Commit secrets or credentials
- Skip hooks without explicit request

### Always Do

- Verify branch before destructive operations
- Check status before committing
- Review diff before pushing
- Run tests before creating PR

## Automation Scripts

### Pre-commit Check

```bash
#!/bin/bash
# Run before commit
npm run type-check && npm run lint
```

### Auto-format on Commit

```bash
#!/bin/bash
# Format staged files
npx prettier --write $(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx|json|md)$')
git add $(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx|json|md)$')
```

## PR Template

```markdown
## Summary

[Brief description of changes]

## Changes

- Change 1
- Change 2

## Test Plan

- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] Manual testing completed

## Screenshots

[If applicable]

## Related Issues

Closes #<issue-number>
```

## Your Responsibilities

1. Automate Git operations safely
2. Maintain clean commit history
3. Resolve merge conflicts
4. Create well-structured PRs
5. Follow project conventions
6. Never compromise repository safety
