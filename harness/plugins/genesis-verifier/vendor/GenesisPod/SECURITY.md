# Security Policy / 安全策略

[English](#english) · [中文](#中文)

---

## English

### Reporting a vulnerability

**Please do not open public issues for security vulnerabilities.**

Report privately via one of:

- GitHub **Security Advisories** → "Report a vulnerability" (preferred)
- Email: **hello@gens.team** (subject: `GenesisPod security`)

Please include: affected version/commit, reproduction steps, impact, and any
proof-of-concept. We aim to acknowledge within **72 hours** and to provide a
remediation timeline after triage.

### Supported versions

Security fixes are provided for the latest released minor version on `main`.
Older versions are best-effort only.

### Handling secrets (important for self-hosters)

GenesisPod uses BYOK (bring-your-own-key) and a secrets module. When deploying:

- **Never commit real secrets.** Use `.env` (git-ignored) from `.env.example`.
- Rotate any key that has ever appeared in a shell history, log, or commit.
- The repository runs a `gitleaks` CI scan on every push/PR to block secret
  leaks; do not disable it.

---

## 中文

### 漏洞上报

**请勿为安全漏洞创建公开 issue。**

请通过以下任一私密渠道上报：

- GitHub **Security Advisories** → "Report a vulnerability"（首选）
- 邮箱：**hello@gens.team**（主题：`GenesisPod security`）

请附上：受影响版本 / commit、复现步骤、影响范围，以及任何 PoC。我们力争在
**72 小时**内确认，并在分级后给出修复时间表。

### 支持的版本

安全修复针对 `main` 上最新发布的次版本提供。更早版本仅尽力而为。

### 密钥处理（自托管者必读）

GenesisPod 使用 BYOK（自带密钥）与 secrets 模块。部署时：

- **绝不提交真实密钥。** 基于 `.env.example` 使用被 git 忽略的 `.env`。
- 任何曾出现在 shell 历史、日志或 commit 中的密钥都必须轮换。
- 仓库在每次 push/PR 上运行 `gitleaks` CI 扫描以拦截密钥泄露，请勿关闭它。
