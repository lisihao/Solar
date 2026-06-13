#!/usr/bin/env bash
# build-bundle.sh — 开发侧：build 镜像 + push 到 ghcr.io + 打 config bundle
#
# 用法：
#   bash infra/onprem/scripts/build-bundle.sh [VERSION] [选项]
#
# 选项：
#   --skip-build         跳过 docker build（复用本地已有镜像）
#   --no-push            只 build/tag，不 push 到 ghcr（本地验证用）
#   --owner <name>       覆盖 GHCR_OWNER（默认从 git remote 解析）
#
# 示例：
#   bash build-bundle.sh                              # 自动版本号 + push
#   bash build-bundle.sh v1.0.0                       # 显式版本 + push
#   bash build-bundle.sh v1.0.0 --skip-build          # 复用本地镜像 + push
#   bash build-bundle.sh v1.0.0 --no-push             # 只 build，不 push
#
# 前置条件：
#   docker login ghcr.io 已登录（PAT 含 write:packages）
#
# 产物：
#   - 镜像 push 到 ghcr.io/<owner>/genesis-{backend,frontend,ai-service}:<version>
#   - dist/onprem/genesis-config-<version>.tar.gz（~10KB，含 compose/env/install/upgrade/README/VERSION）

set -euo pipefail

# ── 颜色（仅 TTY） ────────────────────────────────────────
if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_DIM=''; C_RESET=''
fi
log()  { echo "${C_GREEN}==>${C_RESET} $*"; }
warn() { echo "${C_YELLOW}!! ${C_RESET} $*" >&2; }
die()  { echo "${C_RED}xx ${C_RESET} $*" >&2; exit 1; }

# ── 路径解析 ──────────────────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ONPREM_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
PROJECT_ROOT="$( cd "${ONPREM_DIR}/../.." && pwd )"

# ── 参数解析 ──────────────────────────────────────────────
VERSION=""
SKIP_BUILD=0
PUSH=1
GHCR_OWNER_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-push)    PUSH=0 ;;
    --owner)      shift; GHCR_OWNER_ARG="$1" ;;
    -h|--help)
      grep '^#' "$0" | head -25
      exit 0
      ;;
    *) VERSION="$1" ;;
  esac
  shift
done

# ── VERSION 自动检测（CLI > git tag > package.json + SHA > 纯 SHA）
if [ -z "$VERSION" ]; then
  if TAG="$(git -C "$PROJECT_ROOT" describe --tags --exact-match HEAD 2>/dev/null)"; then
    VERSION="$TAG"
    log "VERSION 未指定，使用当前 commit 的 git tag: ${C_BOLD}${VERSION}${C_RESET}"
  elif [ -f "${PROJECT_ROOT}/package.json" ] \
       && SHA="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null)" \
       && command -v node >/dev/null; then
    PKG_VER="$(node -p "require('${PROJECT_ROOT}/package.json').version" 2>/dev/null || echo "")"
    if [ -n "$PKG_VER" ]; then
      VERSION="${PKG_VER}-${SHA}"
      log "VERSION 未指定，使用 package.json version + git SHA: ${C_BOLD}${VERSION}${C_RESET}"
    fi
  fi
  if [ -z "$VERSION" ]; then
    if SHA="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null)"; then
      VERSION="$SHA"
      log "VERSION 未指定，使用 git short SHA: ${C_BOLD}${VERSION}${C_RESET}"
    else
      die "VERSION 未指定，且既不在 git 仓库也无 package.json"
    fi
  fi
fi

# ── GHCR_OWNER 默认 ───────────────────────────────────────
# 优先级：--owner CLI > GHCR_OWNER env > 默认 genesis-release（GitHub org）
# 镜像发布到 org 命名空间是为了不暴露任何开发者的个人 GitHub 用户名（客户 docker pull URL 里能看到 owner）
GHCR_OWNER="${GHCR_OWNER_ARG:-${GHCR_OWNER:-genesis-release}}"
log "GHCR_OWNER: ${C_BOLD}${GHCR_OWNER}${C_RESET}"

# ── 环境检查 ──────────────────────────────────────────────
command -v docker >/dev/null || die "需要 docker"
docker info >/dev/null 2>&1 || die "docker daemon 未运行"
command -v tar    >/dev/null || die "需要 tar"

if [ "$PUSH" -eq 1 ]; then
  # 验证 docker login ghcr.io
  if ! docker info 2>/dev/null | grep -q "ghcr.io"; then
    # 通过 ~/.docker/config.json 间接验
    if ! grep -q "ghcr.io" "${HOME}/.docker/config.json" 2>/dev/null; then
      warn "未检测到 ghcr.io 登录凭据"
      warn "请先跑：${C_BOLD}echo \$GHCR_TOKEN | docker login ghcr.io -u <github-username> --password-stdin${C_RESET}"
      warn "（PAT 需要 write:packages 权限）"
      die "登录后重试，或加 --no-push 跳过 push"
    fi
  fi
fi

# ── 镜像命名 ──────────────────────────────────────────────
GHCR_BACKEND="ghcr.io/${GHCR_OWNER}/genesis-backend:${VERSION}"
GHCR_FRONTEND="ghcr.io/${GHCR_OWNER}/genesis-frontend:${VERSION}"
GHCR_AI_SERVICE="ghcr.io/${GHCR_OWNER}/genesis-ai-service:${VERSION}"
GHCR_INSTALLER="ghcr.io/${GHCR_OWNER}/genesis-installer:${VERSION}"

# ── Build 镜像 ────────────────────────────────────────────
if [ "$SKIP_BUILD" -eq 0 ]; then
  log "Building backend (这一步最慢，~10 分钟)..."
  docker build -t "$GHCR_BACKEND" "${PROJECT_ROOT}/backend"

  log "Building frontend..."
  docker build -t "$GHCR_FRONTEND" "${PROJECT_ROOT}/frontend"

  log "Building ai-service..."
  docker build -t "$GHCR_AI_SERVICE" "${PROJECT_ROOT}/ai-service"
else
  warn "--skip-build 模式：检查或 tag 现有镜像到 ghcr 命名..."
  # 如果只本地有 genesis/backend:VERSION（旧命名），自动 tag 到 ghcr 命名
  for pair in "genesis/backend:${VERSION}|${GHCR_BACKEND}" \
              "genesis/frontend:${VERSION}|${GHCR_FRONTEND}" \
              "genesis/ai-service:${VERSION}|${GHCR_AI_SERVICE}"; do
    OLD="${pair%|*}"; NEW="${pair#*|}"
    if docker image inspect "$NEW" >/dev/null 2>&1; then
      :  # 已存在 ghcr 命名
    elif docker image inspect "$OLD" >/dev/null 2>&1; then
      log "tag $OLD → $NEW"
      docker tag "$OLD" "$NEW"
    else
      die "镜像 $NEW 或 $OLD 都不存在；请去掉 --skip-build 或先 build"
    fi
  done
fi

# ── Push 到 ghcr ──────────────────────────────────────────
# 每个业务镜像 push 两个 tag：`:<version>` (固定版本) + `:latest` (用户默认拉这个)
#   ── 客户不指定 tag 时 docker 默认 :latest，避免每次升级都改 .env 的 *_IMAGE 行。
if [ "$PUSH" -eq 1 ]; then
  for pair in "$GHCR_BACKEND|ghcr.io/${GHCR_OWNER}/genesis-backend:latest" \
              "$GHCR_FRONTEND|ghcr.io/${GHCR_OWNER}/genesis-frontend:latest" \
              "$GHCR_AI_SERVICE|ghcr.io/${GHCR_OWNER}/genesis-ai-service:latest"; do
    VER_TAG="${pair%|*}"; LATEST_TAG="${pair#*|}"
    log "Pushing $VER_TAG..."
    docker push "$VER_TAG"
    log "Tag + push $LATEST_TAG..."
    docker tag "$VER_TAG" "$LATEST_TAG"
    docker push "$LATEST_TAG"
  done
else
  warn "--no-push 模式：跳过 docker push"
fi

# ── Staging：只打包配置 + 脚本（无 images.tar） ───────────
OUTPUT_DIR="${PROJECT_ROOT}/dist/onprem"
BUNDLE_NAME="genesis-config-${VERSION}"
STAGING="${OUTPUT_DIR}/${BUNDLE_NAME}"

mkdir -p "$STAGING"
rm -rf "$STAGING"/*

log "打包客户配置 bundle..."
cp "${ONPREM_DIR}/docker-compose.yml"            "${STAGING}/"
cp "${ONPREM_DIR}/.env.production.example"       "${STAGING}/"
cp "${ONPREM_DIR}/README.md"                     "${STAGING}/"
cp "${ONPREM_DIR}/CUSTOMER-GUIDE.md"             "${STAGING}/"
cp "${ONPREM_DIR}/scripts/genesis.sh"            "${STAGING}/"
cp "${ONPREM_DIR}/scripts/install.sh"            "${STAGING}/"
cp "${ONPREM_DIR}/scripts/upgrade.sh"            "${STAGING}/"

# 把镜像 tag 注入到 .env.production.example 默认值
# ── 走 :latest 而非 :VERSION：客户拉默认 .env 就自动拿到最新版（user request 2026-05-27）。
#    需要 pin 版本时客户自己改这 3 行成 :${VERSION}（或运维通过 envsubst 注入）。
sed -i.bak \
  -e "s|^BACKEND_IMAGE=.*|BACKEND_IMAGE=ghcr.io/${GHCR_OWNER}/genesis-backend:latest|" \
  -e "s|^FRONTEND_IMAGE=.*|FRONTEND_IMAGE=ghcr.io/${GHCR_OWNER}/genesis-frontend:latest|" \
  -e "s|^AI_SERVICE_IMAGE=.*|AI_SERVICE_IMAGE=ghcr.io/${GHCR_OWNER}/genesis-ai-service:latest|" \
  "${STAGING}/.env.production.example"
rm -f "${STAGING}/.env.production.example.bak"

# 写 VERSION 文件供 install.sh / upgrade.sh 读取
echo "$VERSION" > "${STAGING}/VERSION"

# 写 IMAGES 元数据文件供 install.sh / upgrade.sh 知道 pull 什么
cat > "${STAGING}/IMAGES" <<EOF
${GHCR_BACKEND}
${GHCR_FRONTEND}
${GHCR_AI_SERVICE}
EOF

chmod +x "${STAGING}/genesis.sh" "${STAGING}/install.sh" "${STAGING}/upgrade.sh"

# ── Build + push installer 镜像（客户用 docker run 拿配置）───
log "Building installer 镜像（把 staging 烤进 ~6MB alpine）..."
INSTALLER_CTX="${OUTPUT_DIR}/.installer-build-${VERSION}"
rm -rf "$INSTALLER_CTX"
mkdir -p "$INSTALLER_CTX"
cp "${ONPREM_DIR}/installer/Dockerfile"   "${INSTALLER_CTX}/"
cp "${ONPREM_DIR}/installer/entrypoint.sh" "${INSTALLER_CTX}/"
cp -r "$STAGING" "${INSTALLER_CTX}/bundle"
docker build -t "$GHCR_INSTALLER" "$INSTALLER_CTX"
rm -rf "$INSTALLER_CTX"

if [ "$PUSH" -eq 1 ]; then
  log "Pushing $GHCR_INSTALLER..."
  docker push "$GHCR_INSTALLER"
  # 同时打 :latest tag，让 genesis.sh check-update 能拿到
  log "Tag + push installer:latest..."
  docker tag "$GHCR_INSTALLER" "ghcr.io/${GHCR_OWNER}/genesis-installer:latest"
  docker push "ghcr.io/${GHCR_OWNER}/genesis-installer:latest"
else
  warn "--no-push 模式：跳过 installer push"
fi

# ── 打 tar.gz（保留，作为离线 / 备用交付通道）─────────────
log "压缩 config bundle (备用 tar 通道)..."
TARBALL="${OUTPUT_DIR}/${BUNDLE_NAME}.tar.gz"
tar -C "$OUTPUT_DIR" -czf "$TARBALL" "$BUNDLE_NAME"

# 校验和
if command -v sha256sum >/dev/null; then
  SHA="$(sha256sum "$TARBALL" | awk '{print $1}')"
elif command -v shasum >/dev/null; then
  SHA="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
else
  SHA="(skipped, no sha256sum)"
fi

SIZE="$(du -h "$TARBALL" | awk '{print $1}')"

# 清理 staging
rm -rf "$STAGING"

# ── 自动建 git tag + GitHub Release（仅当 VERSION 是 vX.Y.Z 形态且非 dry-run）
#    用 gh CLI: 已登录的 PAT 必须有 repo:write 权限 (release create)。
#    跳过条件：
#      - VERSION 非 semver 形态 (e.g. SHA / -dirty 后缀)
#      - --no-push 模式 (本地验证用，不动远端)
#      - GH_NO_RELEASE=1 (调用方显式拒绝)
#      - gh CLI 不存在
if [ "$PUSH" -eq 1 ] && [ "${GH_NO_RELEASE:-0}" != "1" ] \
   && echo "$VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  if command -v gh >/dev/null 2>&1; then
    log "建 git tag + GitHub Release..."
    # tag：本地不存在就建
    if ! git -C "$PROJECT_ROOT" rev-parse "refs/tags/${VERSION}" >/dev/null 2>&1; then
      git -C "$PROJECT_ROOT" tag "$VERSION"
      log "本地 tag $VERSION 已建"
    fi
    # tag：远端不存在就推
    if ! git -C "$PROJECT_ROOT" ls-remote --tags origin "$VERSION" 2>/dev/null | grep -q "$VERSION"; then
      if git -C "$PROJECT_ROOT" push origin "$VERSION" >/dev/null 2>&1; then
        log "tag $VERSION 已推到 origin"
      else
        warn "tag $VERSION push 失败（pre-push hook 拒绝或网络问题），release 仍可建"
      fi
    fi
    # release：已存在就跳过（gh release view 退非零 = 不存在）
    if gh release view "$VERSION" -R "$(git -C "$PROJECT_ROOT" remote get-url origin | sed -E 's#.*github.com[:/](.+)\.git#\1#')" >/dev/null 2>&1; then
      log "GitHub Release $VERSION 已存在，跳过 create"
    else
      RELEASE_NOTES=$(cat <<RN_EOF
## On-Prem Release ${VERSION}

### Container images (ghcr.io/${GHCR_OWNER})
All images pushed with both \`:${VERSION}\` and \`:latest\` tags.

- \`${GHCR_BACKEND}\`
- \`${GHCR_FRONTEND}\`
- \`${GHCR_AI_SERVICE}\`
- \`${GHCR_INSTALLER}\`

### Customer install
\`\`\`bash
docker login ghcr.io -u <github-user>
docker run --rm -v "\$(pwd):/out" ghcr.io/${GHCR_OWNER}/genesis-installer:latest
cd genesis-config-${VERSION} && bash genesis.sh install
\`\`\`

\`.env.production.example\` defaults to \`:latest\` — customers don't need to pin.

### Bundle
SHA-256: \`${SHA}\`
RN_EOF
)
      if gh release create "$VERSION" "$TARBALL" \
           --title "$VERSION" --notes "$RELEASE_NOTES" >/dev/null 2>&1; then
        log "GitHub Release $VERSION 已创建（含 ${BUNDLE_NAME}.tar.gz asset）"
      else
        warn "gh release create 失败（gh 未登录 / repo:write 缺失 / tag 不存在）"
        warn "手动建：${C_BOLD}gh release create $VERSION $TARBALL --title $VERSION${C_RESET}"
      fi
    fi
  else
    warn "未检测到 gh CLI，跳过自动 release 创建"
    warn "安装：${C_BOLD}winget install GitHub.cli${C_RESET} 或 https://cli.github.com/"
  fi
fi

# ── 报告 ──────────────────────────────────────────────────
cat <<EOF

${C_BOLD}${C_GREEN}✓ 发布完成${C_RESET}

  Version          : ${C_BOLD}${VERSION}${C_RESET}
  Config bundle    : ${TARBALL}
  Size             : ${SIZE}
  SHA-256          : ${SHA}

  Images on ghcr.io (both :${VERSION} and :latest tags pushed):
    ${GHCR_BACKEND}
    ${GHCR_FRONTEND}
    ${GHCR_AI_SERVICE}
    ${GHCR_INSTALLER}  ${C_DIM}← 客户用这个拿配置${C_RESET}
  ${C_DIM}默认 .env 走 :latest，客户无需指定版本即可拉到最新发布${C_RESET}

${C_DIM}给客户的部署指引（首选：docker run，零文件传输）：${C_RESET}
  1. 在 org 加客户为 packages collaborator (Read)
     https://github.com/orgs/${GHCR_OWNER}/packages
  2. 客户在服务器跑：
     ${C_BOLD}docker login ghcr.io -u <客户自己的 github 用户名>${C_RESET}
     ${C_BOLD}docker run --rm -v "\$(pwd):/out" ${GHCR_INSTALLER}${C_RESET}
     ${C_BOLD}cd genesis-config-${VERSION} && bash genesis.sh install${C_RESET}

${C_DIM}备用：离线 / 不能连 ghcr 的客户走 tar 通道${C_RESET}
  scp ${BUNDLE_NAME}.tar.gz customer:/tmp/
  客户：tar -xzf /tmp/${BUNDLE_NAME}.tar.gz && cd ${BUNDLE_NAME} && bash genesis.sh install
  （客户仍需 docker login ghcr.io 才能 pull 业务镜像）
EOF
