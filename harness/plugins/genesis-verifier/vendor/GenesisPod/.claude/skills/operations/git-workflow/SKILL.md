---
name: Git Workflow
description: Manage Git operations, branches, commits, and pull requests following GenesisPod conventions
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
tags:
  - git
  - workflow
  - ci-cd
---

# Git Workflow Expert

You are an expert at managing Git workflows and CI/CD for GenesisPod.

## Branch Strategy

```
main                    # Production-ready code
├── develop            # Integration branch (optional)
├── feature/001-xxx    # New features
├── bugfix/002-xxx     # Bug fixes
├── hotfix/003-xxx     # Urgent production fixes
└── platform-refactor  # Major refactoring work
```

## Naming Conventions

### Branch Names

```
feature/001-add-user-authentication
bugfix/002-fix-login-redirect
hotfix/003-security-patch
refactor/004-database-migration
```

### Commit Messages (Conventional Commits)

```
feat(auth): add JWT refresh token support
fix(api): resolve N+1 query in resources endpoint
docs(readme): update installation instructions
style(frontend): format with prettier
refactor(service): extract validation logic
test(unit): add ResourceService coverage
chore(deps): upgrade nestjs to v10
```

**Format**: `type(scope): description`

| Type     | Description                 |
| -------- | --------------------------- |
| feat     | New feature                 |
| fix      | Bug fix                     |
| docs     | Documentation               |
| style    | Formatting (no code change) |
| refactor | Code restructuring          |
| test     | Adding tests                |
| chore    | Maintenance tasks           |
| perf     | Performance improvements    |

## Common Git Operations

```bash
# Start new feature
git checkout main
git pull origin main
git checkout -b feature/001-new-feature

# Daily workflow
git add .
git commit -m "feat(scope): description"
git push -u origin feature/001-new-feature

# Update from main
git fetch origin main
git rebase origin/main
# or
git merge origin/main

# Create PR
gh pr create --title "feat: Add new feature" --body "Description..."

# Squash merge (preferred)
gh pr merge --squash

# Check CI status
gh pr checks

# View PR comments
gh pr view --comments
```

## Pre-commit Hooks (Husky)

The project uses Husky + lint-staged for pre-commit validation:

```json
// .lintstagedrc.json
{
  "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"]
}
```

## CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
jobs:
  quality:
    - npm run format:check # Prettier
    - npm run lint # ESLint
    - npm run type-check # TypeScript

  test:
    - npm run test:backend # Jest
    - npm run test:frontend # Vitest
    - npm run test:coverage # Coverage reports

  deploy:
    - Railway auto-deploy on merge to main
```

## Pull Request Template

```markdown
## Summary

Brief description of changes

## Type of Change

- [ ] New feature
- [ ] Bug fix
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Unit tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing completed

## Checklist

- [ ] Code follows project conventions
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No sensitive data exposed
```

## Merge Strategies

1. **Feature branches**: Squash merge (clean history)
2. **Hotfixes**: Regular merge (preserve commit for tracking)
3. **Release branches**: Regular merge with tag

## Your Responsibilities

1. Create properly named branches
2. Write clear, conventional commit messages
3. Ensure CI passes before merge
4. Keep commits atomic and focused
5. Rebase to maintain clean history
6. Create comprehensive PR descriptions
7. Resolve merge conflicts carefully
