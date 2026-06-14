#!/usr/bin/env bash
# genesis.sh — GenesisPod 客户侧统一运维入口
#
# 用法：
#   bash genesis.sh <command> [args]
#
# 命令：
#   preflight                    安装前体检：docker / 磁盘 / 内存 / ghcr 连通性
#   install                      首次部署（自动跑 preflight）
#   check-update                 检查 ghcr 上是否有新版本
#   upgrade <vX.Y.Z|tar.gz>      升级（推荐：直接传版本号，自动从 ghcr 拉）
#   backup [output-dir]          备份 PostgreSQL + volumes 为单个 tar.gz
#   restore <backup.tar.gz>      从备份恢复（破坏性，二次确认）
#   status                       打印全栈健康度
#   logs [service]               看日志（默认 backend，可指定 frontend/postgres 等）
#   uninstall                    彻底拆卸（破坏性，输入 DELETE 确认）
#   help                         本帮助
#
# 示例：
#   bash genesis.sh install
#   bash genesis.sh status
#   bash genesis.sh check-update
#   bash genesis.sh upgrade v40.3.0           # 一键升级（首选）
#   bash genesis.sh upgrade /tmp/bundle.tar.gz   # 离线升级
#
# 环境变量（可选）：
#   SKIP_PROMPTS=1   install 非交互模式（admin 用随机密码自动填）
#   FORCE=1          upgrade 跳过同版本 / 降级警告
#   INSTALL_DIR      默认安装目录（仅 install）

set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────
if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'; C_CYAN=$'\033[36m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''; C_DIM=''; C_RESET=''
fi
log()  { echo "${C_GREEN}==>${C_RESET} $*"; }
warn() { echo "${C_YELLOW}!! ${C_RESET} $*" >&2; }
die()  { echo "${C_RED}xx ${C_RESET} $*" >&2; exit 1; }

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# ── docker compose v2 / v1 适配 ───────────────────────────
detect_dc() {
  if docker compose version >/dev/null 2>&1; then
    DC=(docker compose)
  elif command -v docker-compose >/dev/null; then
    DC=(docker-compose)
    warn "用的是 docker-compose v1，建议升级到 v2"
  else
    die "需要 docker compose v2 或 docker-compose v1"
  fi
}

# ── 命令实现 ──────────────────────────────────────────────

cmd_preflight() {
  echo
  echo "${C_BOLD}GenesisPod 安装前体检${C_RESET}"
  echo

  local fail=0
  check() {
    local name="$1" cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
      echo "  ${C_GREEN}✓${C_RESET} $name"
    else
      echo "  ${C_RED}✗${C_RESET} $name"
      fail=1
    fi
  }

  check "docker 24+"           "docker --version | grep -qE 'version (2[4-9]|[3-9][0-9])\.'"
  check "docker daemon 在跑"   "docker info"
  check "docker compose v2"    "docker compose version"
  check "openssl"              "command -v openssl"
  check "tar"                  "command -v tar"
  check "curl"                 "command -v curl"
  check "可访问 ghcr.io"       "curl -sfI -m 10 https://ghcr.io"
  check "已 docker login ghcr.io"  "grep -q ghcr.io \"$HOME/.docker/config.json\""

  # 磁盘（/var/lib/docker 路径优先，回退到 /）
  local docker_root disk_avail mem_avail cpu_count
  docker_root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  [ -d "$docker_root" ] || docker_root="/"
  disk_avail="$(df -BG "$docker_root" 2>/dev/null | awk 'NR==2{gsub("G","",$4);print $4}' || echo 0)"
  mem_avail="$(free -g 2>/dev/null | awk '/^Mem/{print $2}' || echo 0)"
  cpu_count="$(nproc 2>/dev/null || echo 0)"

  if [ "$disk_avail" -ge 30 ] 2>/dev/null; then
    echo "  ${C_GREEN}✓${C_RESET} 磁盘 ≥ 30GB（${docker_root}: 可用 ${disk_avail}GB）"
  else
    echo "  ${C_YELLOW}!${C_RESET} 磁盘 < 30GB（${docker_root}: 仅 ${disk_avail}GB），可能装不下镜像 + 数据"
  fi

  if [ "$mem_avail" -ge 4 ] 2>/dev/null; then
    echo "  ${C_GREEN}✓${C_RESET} 内存 ≥ 4GB（实际 ${mem_avail}GB）"
  else
    echo "  ${C_YELLOW}!${C_RESET} 内存 < 4GB（实际 ${mem_avail}GB），可能跑不稳"
  fi

  if [ "$cpu_count" -ge 2 ] 2>/dev/null; then
    echo "  ${C_GREEN}✓${C_RESET} CPU ≥ 2 核（实际 ${cpu_count} 核）"
  else
    echo "  ${C_YELLOW}!${C_RESET} CPU < 2 核（实际 ${cpu_count} 核），LLM 调用并发会很慢"
  fi

  # 端口 3000 占用（ss / netstat / /proc 多套兜底）
  local PORT_USED=0
  if command -v ss >/dev/null; then
    ss -tln 2>/dev/null | grep -q ':3000 ' && PORT_USED=1
  elif command -v netstat >/dev/null; then
    netstat -tln 2>/dev/null | grep -q ':3000 ' && PORT_USED=1
  elif [ -r /proc/net/tcp ]; then
    awk 'NR>1 && $2 ~ /:0BB8$/ {exit 0} END{exit 1}' /proc/net/tcp && PORT_USED=1
  fi
  if [ "$PORT_USED" = "1" ]; then
    echo "  ${C_YELLOW}!${C_RESET} 端口 3000 已被占用（请改 FRONTEND_PORT 或停掉占用进程）"
  else
    echo "  ${C_GREEN}✓${C_RESET} 端口 3000 可用"
  fi

  # Docker storage driver（overlay2 推荐；其他会有性能问题）
  local driver
  driver="$(docker info -f '{{.Driver}}' 2>/dev/null || echo unknown)"
  if [ "$driver" = "overlay2" ]; then
    echo "  ${C_GREEN}✓${C_RESET} Docker storage driver: overlay2"
  else
    echo "  ${C_YELLOW}!${C_RESET} Docker storage driver: ${driver}（推荐 overlay2，性能更好）"
  fi

  # 时钟同步（JWT 签名 + 数据库主从依赖时钟）
  if command -v timedatectl >/dev/null; then
    if timedatectl status 2>/dev/null | grep -qE 'NTP service: active|System clock synchronized: yes'; then
      echo "  ${C_GREEN}✓${C_RESET} 系统时钟已同步"
    else
      echo "  ${C_YELLOW}!${C_RESET} 系统时钟未同步，可能导致 JWT 签名失败 / 数据库时间戳偏差"
    fi
  fi

  echo
  if [ "$fail" -eq 1 ]; then
    die "体检未通过；请先解决上面 ✗ 项"
  fi
  log "体检通过 ✓（黄色 ! 项不阻塞但建议优化）"
}

cmd_install() {
  cmd_preflight

  # 必备文件
  for f in IMAGES docker-compose.yml .env.production.example; do
    [ -f "$f" ] || die "缺少 $f；请确认在正确的 bundle 解压目录里运行此脚本"
  done

  detect_dc
  VERSION="$(cat VERSION 2>/dev/null || echo unknown)"

  echo
  echo "${C_BOLD}GenesisPod On-Prem Installer${C_RESET}  (version: ${C_CYAN}${VERSION}${C_RESET})"
  echo

  if [ "$(id -u)" -eq 0 ]; then
    warn "你正在用 root 用户运行；建议把当前用户加入 docker 组后切换非 root"
  fi

  # docker pull
  log "从 ghcr.io 拉取镜像（首次 ~3.4GB / 几分钟，看带宽）..."
  while IFS= read -r img; do
    [ -z "$img" ] && continue
    log "  pulling $img"
    docker pull "$img" || die "拉取失败：$img（确认 PAT 权限 + 镜像 visibility）"
  done < IMAGES

  # .env.production 准备
  if [ -f .env.production ]; then
    warn ".env.production 已存在，跳过密钥生成（如需重置，请删除该文件后重跑）"
  else
    log "生成 .env.production（自动填随机密钥）..."
    cp .env.production.example .env.production

    gen_key() { openssl rand -hex 32; }
    gen_pw()  { openssl rand -base64 32 | tr -d '+/=' | head -c 32; }

    ensure_kv() {
      local key="$1" val="$2"
      if grep -qE "^${key}=" .env.production; then
        awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' \
          .env.production > .env.production.tmp && mv .env.production.tmp .env.production
      else
        echo "${key}=${val}" >> .env.production
      fi
    }

    ensure_kv POSTGRES_PASSWORD       "$(gen_pw)"
    ensure_kv REDIS_PASSWORD          "$(gen_pw)"
    ensure_kv JWT_SECRET              "$(gen_key)"
    ensure_kv JWT_REFRESH_SECRET      "$(gen_key)"
    ensure_kv SETTINGS_ENCRYPTION_KEY "$(gen_key)"
    ensure_kv STORAGE_ADMIN_KEY       "$(gen_key)"

    if [ "${SKIP_PROMPTS:-0}" != "1" ]; then
      echo
      echo "${C_BOLD}请填写管理员账号信息${C_RESET}（首次启动后自动创建，登录后立即改密码）"
      read -r -p "  Admin email      : " ADMIN_EMAIL
      while [ -z "${ADMIN_EMAIL// }" ]; do
        read -r -p "  Admin email      : " ADMIN_EMAIL
      done
      read -r -s -p "  Admin password   : " ADMIN_PW; echo
      while [ ${#ADMIN_PW} -lt 8 ]; do
        warn "密码至少 8 字符"
        read -r -s -p "  Admin password   : " ADMIN_PW; echo
      done

      echo
      echo "${C_BOLD}对外访问地址${C_RESET}（浏览器输入的 URL，例：https://genesis.example.com 或 http://192.168.1.100:3000）"
      echo "${C_DIM}留空 = 同源模式（适合 nginx 反代），跳过即可${C_RESET}"
      read -r -p "  Public base URL  : " PUBLIC_URL

      ensure_kv ADMIN_INITIAL_EMAIL    "$ADMIN_EMAIL"
      ensure_kv ADMIN_INITIAL_PASSWORD "$ADMIN_PW"
      ensure_kv ADMIN_EMAILS           "$ADMIN_EMAIL"
      ensure_kv PUBLIC_BASE_URL        "$PUBLIC_URL"
      ensure_kv FRONTEND_URL           "$PUBLIC_URL"
    else
      # SKIP_PROMPTS=1 模式：客户必须传 ADMIN_EMAIL env var；
      # 否则用占位符 admin@genesis.local（绝对不用任何开发者私人邮箱）
      AUTO_ADMIN_PW="$(gen_pw)"
      ADMIN_EMAIL_FINAL="${ADMIN_EMAIL:-admin@genesis.local}"
      ensure_kv ADMIN_INITIAL_EMAIL    "$ADMIN_EMAIL_FINAL"
      ensure_kv ADMIN_INITIAL_PASSWORD "$AUTO_ADMIN_PW"
      ensure_kv ADMIN_EMAILS           "$ADMIN_EMAIL_FINAL"
      ensure_kv PUBLIC_BASE_URL        ""
      ensure_kv FRONTEND_URL           ""
      warn "SKIP_PROMPTS=1 模式：admin 已用随机密码自动填充"
      warn "  email    : ${ADMIN_EMAIL_FINAL}"
      warn "  password : ${AUTO_ADMIN_PW}"
      warn "  请记录上述凭据，登录后立即修改"
      if [ "$ADMIN_EMAIL_FINAL" = "admin@genesis.local" ]; then
        warn "  ⚠ 未指定 ADMIN_EMAIL 环境变量，使用占位邮箱；登录后请改成你的真实邮箱"
      fi
    fi

    chmod 600 .env.production
    log ".env.production 已生成（权限 600，仅 owner 可读）"
  fi

  log "启动服务（首次启动会跑数据库迁移 + seed，可能 3-5 分钟）..."
  "${DC[@]}" --env-file .env.production up -d

  log "等待 backend 健康检查通过（最长 30 分钟，含首次 prisma migrate 全量执行）..."
  local HEALTHY=0 STATUS LAST_MIG
  for i in $(seq 1 180); do
    STATUS="$(docker inspect genesis-backend --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
    if [ "$STATUS" = "healthy" ]; then
      HEALTHY=1
      "${DC[@]}" --env-file .env.production up -d >/dev/null 2>&1 || true
      break
    fi
    if [ $((i % 6)) -eq 0 ]; then
      LAST_MIG="$(docker logs genesis-backend --tail 100 2>&1 | grep -oE 'Migration [0-9_a-z]+' | tail -1 || echo '?')"
      echo "  ${C_DIM}已等待 $((i*10))s，状态: ${STATUS}, 进度: ${LAST_MIG}${C_RESET}"
    fi
    sleep 10
  done

  if [ "$HEALTHY" -ne 1 ]; then
    warn "backend 未在 30 分钟内 healthy；查看日志：bash genesis.sh logs"
    exit 1
  fi

  local PORT
  PORT="$(grep '^FRONTEND_PORT=' .env.production | cut -d= -f2 || echo 3000)"
  PORT="${PORT:-3000}"

  cat <<EOF

${C_BOLD}${C_GREEN}✓ GenesisPod 部署完成${C_RESET}

  访问地址 : ${C_CYAN}http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}${C_RESET}
             ${C_DIM}（或你配置的 PUBLIC_BASE_URL）${C_RESET}

  下一步  :
    1. 浏览器打开上述地址
    2. 用你刚填的 admin email / password 登录
    3. ${C_BOLD}立即修改密码${C_RESET}
    4. 进入「系统 → AI → 模型 / 工具」，录入 LLM API key（BYOK）

  常用命令 :
    查看状态  : ${C_BOLD}bash genesis.sh status${C_RESET}
    查看日志  : ${C_BOLD}bash genesis.sh logs${C_RESET}
    备份     : ${C_BOLD}bash genesis.sh backup${C_RESET}
    检查新版  : ${C_BOLD}bash genesis.sh check-update${C_RESET}
    升级     : ${C_BOLD}bash genesis.sh upgrade vX.Y.Z${C_RESET}

  完整文档 : ${C_CYAN}https://github.com/genesis-release/docs${C_RESET}
             ${C_DIM}（也可看本地 ./CUSTOMER-GUIDE.md，离线一致）${C_RESET}

${C_DIM}配置文件位置：${SCRIPT_DIR}/.env.production
（含敏感密钥，权限 600；备份时务必加密）${C_RESET}
EOF
}

cmd_upgrade() {
  local ARG="${1:-}"
  [ -n "$ARG" ] || die "用法：bash genesis.sh upgrade <vX.Y.Z | /path/to/bundle.tar.gz>"

  [ -f .env.production ] || die "当前目录无 .env.production；请在原 install 目录里运行"
  [ -f VERSION ] || die "当前目录无 VERSION 文件；目录布局有问题"
  [ -f IMAGES ] || die "当前目录无 IMAGES 文件"

  detect_dc

  local OLD_VERSION TMP NEW_DIR NEW_VERSION
  OLD_VERSION="$(cat VERSION)"

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  if [[ "$ARG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    # 模式 A：版本号 —— 从 ghcr 拉 installer 镜像取新配置
    local TARGET_VERSION="$ARG"
    [[ "$TARGET_VERSION" =~ ^v ]] || TARGET_VERSION="v$TARGET_VERSION"

    local INSTALLER_BASE INSTALLER_IMG
    INSTALLER_BASE="$(head -1 IMAGES | sed 's|/[^/]*:[^/]*$||')/genesis-installer"
    INSTALLER_IMG="${INSTALLER_BASE}:${TARGET_VERSION}"

    grep -q "ghcr.io" "${HOME}/.docker/config.json" 2>/dev/null \
      || die "未检测到 ghcr.io 登录凭据；请先 docker login ghcr.io"

    log "从 ghcr 拉取 installer ${INSTALLER_IMG}..."
    docker pull "$INSTALLER_IMG" >/dev/null 2>&1 \
      || die "拉取失败：$INSTALLER_IMG（版本号是否存在？检查 ghcr 权限）"

    log "解包新配置到临时目录..."
    docker run --rm -v "${TMP}:/out" "$INSTALLER_IMG" >/dev/null
    NEW_DIR="${TMP}/genesis-config-${TARGET_VERSION}"
    [ -d "$NEW_DIR" ] || die "installer 输出目录异常：${NEW_DIR}"
  elif [ -f "$ARG" ]; then
    # 模式 B：tar.gz 路径（离线 / 向后兼容）
    log "解包 ${ARG} 到临时目录..."
    tar -xzf "$ARG" -C "$TMP"
    NEW_DIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
    [ -d "$NEW_DIR" ] || die "bundle 结构异常，找不到顶层目录"
  else
    die "参数既不是 vX.Y.Z 版本号也不是 .tar.gz 文件：$ARG"
  fi

  [ -f "${NEW_DIR}/VERSION" ] || die "新 bundle 里没有 VERSION 文件"
  [ -f "${NEW_DIR}/IMAGES" ] || die "新 bundle 里没有 IMAGES 元数据文件"

  NEW_VERSION="$(cat "${NEW_DIR}/VERSION")"

  echo
  echo "  当前版本: ${C_DIM}${OLD_VERSION}${C_RESET}"
  echo "  目标版本: ${C_BOLD}${NEW_VERSION}${C_RESET}"
  echo

  if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
    if [ "${FORCE:-0}" != "1" ]; then
      warn "新版本与当前版本相同（${OLD_VERSION}）"
      read -r -p "  仍要继续重装吗? [y/N] " ANS
      case "${ANS:-N}" in [yY]*) ;; *) die "已取消"; esac
    fi
  fi

  ver_compare() {
    local a="${1#v}" b="${2#v}"
    a="${a%%-*}"; b="${b%%-*}"
    printf '%s\n%s\n' "$a" "$b" | sort -V -C 2>/dev/null && echo lt && return
    printf '%s\n%s\n' "$b" "$a" | sort -V -C 2>/dev/null && echo gt && return
    echo eq
  }

  if [ "$OLD_VERSION" != "$NEW_VERSION" ]; then
    local CMP
    CMP="$(ver_compare "$OLD_VERSION" "$NEW_VERSION")"
    if [ "$CMP" = "gt" ]; then
      warn "目标版本 ${NEW_VERSION} 比当前 ${OLD_VERSION} ${C_BOLD}低${C_RESET}（降级）"
      warn "降级可能导致数据库 schema 不兼容"
      if [ "${FORCE:-0}" != "1" ]; then
        read -r -p "  确认降级? 输入版本号 [${NEW_VERSION}] 以继续: " ANS
        [ "$ANS" = "$NEW_VERSION" ] || die "已取消"
      fi
    fi
  fi

  # 检查 ghcr.io 登录
  grep -q "ghcr.io" "${HOME}/.docker/config.json" 2>/dev/null \
    || die "未检测到 ghcr.io 登录凭据；请先 docker login ghcr.io"

  local TS BACKUP
  TS="$(date +%Y%m%d_%H%M%S)"
  BACKUP=".env.production.bak.${TS}"
  cp .env.production "$BACKUP"
  chmod 600 "$BACKUP"
  log "已备份 .env.production → ${BACKUP}"

  # ── 升级前数据库快照（回滚点）──────────────────────────────
  # 原流程只备份 .env，未备份数据库；schema 变更 / BYOK v2 迁移失败时无快照可回。
  local DB_SNAP="db-preupgrade-${OLD_VERSION}-${TS}.sql.gz"
  log "升级前快照数据库 → ${DB_SNAP}（回滚点）..."
  if "${DC[@]}" exec -T postgres pg_dump -U genesis genesis 2>/dev/null | gzip > "$DB_SNAP" \
     && [ -s "$DB_SNAP" ]; then
    chmod 600 "$DB_SNAP"
    log "  数据库快照完成（$(du -h "$DB_SNAP" | awk '{print $1}')）"
  else
    rm -f "$DB_SNAP"
    DB_SNAP=""
    warn "数据库快照失败（postgres 未运行？）"
    if [ "${FORCE:-0}" != "1" ]; then
      read -r -p "  无快照仍要升级? [y/N] " ANS
      case "${ANS:-N}" in [yY]*) ;; *) die "已取消；建议先 bash genesis.sh backup 再升级"; esac
    fi
  fi

  # ── BYOK 加固检查：KEK 隔离（v50.5.0+ 信封加密）─────────────
  # 未配 SETTINGS_KEK_V1 时 EnvKekProvider 会从 SETTINGS_ENCRYPTION_KEY 派生 KEK（可用但未隔离）。
  # ★ 这里只告警不自动改：已写入 v2 数据后更换 KEK 会导致旧密文解不开（须先跑 KEK 轮换 re-wrap 作业）。
  if ! grep -qE '^SETTINGS_KEK_V1=.+' .env.production; then
    warn "未配置 SETTINGS_KEK_V1：BYOK 信封加密的 KEK 当前从 SETTINGS_ENCRYPTION_KEY 派生（可用，但 KEK 与数据加密 key 未隔离）"
    warn "  如需隔离：${C_BOLD}首次升级到 v2 版本前${C_RESET}往 .env.production 加 SETTINGS_KEK_V1=\$(openssl rand -hex 32)"
    warn "  已有 v2 数据后再加/换 KEK，须先跑 KEK 轮换 re-wrap 作业，否则旧密文解不开"
  fi

  log "从 ghcr.io 拉取新镜像..."
  while IFS= read -r img; do
    [ -z "$img" ] && continue
    log "  pulling $img"
    docker pull "$img" || die "拉取失败：$img"
  done < "${NEW_DIR}/IMAGES"

  log "更新部署配置（保留 .env.production）..."
  cp "${NEW_DIR}/docker-compose.yml" ./docker-compose.yml
  cp "${NEW_DIR}/genesis.sh"         ./genesis.sh 2>/dev/null || true
  cp "${NEW_DIR}/install.sh"         ./install.sh 2>/dev/null || true
  cp "${NEW_DIR}/upgrade.sh"         ./upgrade.sh 2>/dev/null || true
  cp "${NEW_DIR}/README.md"          ./README.md 2>/dev/null || true
  cp "${NEW_DIR}/VERSION"            ./VERSION
  cp "${NEW_DIR}/IMAGES"             ./IMAGES
  cp "${NEW_DIR}/.env.production.example" ./.env.production.example
  chmod +x genesis.sh install.sh upgrade.sh 2>/dev/null || true

  log "更新镜像 tag 引用..."
  local NEW_BACKEND NEW_FRONTEND NEW_AI
  NEW_BACKEND="$(sed -n '1p' "${NEW_DIR}/IMAGES")"
  NEW_FRONTEND="$(sed -n '2p' "${NEW_DIR}/IMAGES")"
  NEW_AI="$(sed -n '3p' "${NEW_DIR}/IMAGES")"

  sed -i.upgradebak \
    -e "s|^BACKEND_IMAGE=.*|BACKEND_IMAGE=${NEW_BACKEND}|" \
    -e "s|^FRONTEND_IMAGE=.*|FRONTEND_IMAGE=${NEW_FRONTEND}|" \
    -e "s|^AI_SERVICE_IMAGE=.*|AI_SERVICE_IMAGE=${NEW_AI}|" \
    .env.production
  rm -f .env.production.upgradebak

  log "滚动重启容器（保留 postgres / redis volume）..."
  "${DC[@]}" --env-file .env.production up -d --force-recreate --no-deps backend frontend ai-service

  log "等待 backend 健康检查通过..."
  local HEALTHY=0 STATUS
  for i in $(seq 1 60); do
    STATUS="$(docker inspect genesis-backend --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
    [ "$STATUS" = "healthy" ] && { HEALTHY=1; break; }
    [ $((i % 6)) -eq 0 ] && echo "  ${C_DIM}已等待 $((i*10))s, 状态: ${STATUS}${C_RESET}"
    sleep 10
  done

  if [ "$HEALTHY" -ne 1 ]; then
    warn "backend 未在 10 分钟内 healthy；查看日志：bash genesis.sh logs"
    warn "回滚步骤："
    warn "  1) 恢复配置：cp ${BACKUP} .env.production"
    if [ -n "${DB_SNAP:-}" ] && [ -f "${DB_SNAP}" ]; then
      warn "  2) 恢复数据库：gunzip -c ${DB_SNAP} | ${DC[*]} exec -T postgres psql -U genesis genesis"
      warn "  3) 重装旧版本：bash genesis.sh upgrade ${OLD_VERSION}"
    else
      warn "  2) 重装旧版本：bash genesis.sh upgrade ${OLD_VERSION}（注意：本次无 DB 快照）"
    fi
    exit 1
  fi

  cat <<EOF

${C_BOLD}${C_GREEN}✓ 升级完成${C_RESET}

  ${OLD_VERSION} ${C_DIM}→${C_RESET} ${C_BOLD}${NEW_VERSION}${C_RESET}

  .env.production 备份: ${BACKUP}
EOF
}

cmd_backup() {
  local OUT="${1:-./backups}"
  [ -f .env.production ] || die "当前目录无 .env.production"
  mkdir -p "$OUT"
  detect_dc

  local TS FILE
  TS="$(date +%Y%m%d_%H%M%S)"
  FILE="${OUT}/genesis-backup-${TS}.tar.gz"

  local TMP
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  log "导出 PostgreSQL..."
  "${DC[@]}" exec -T postgres pg_dump -U genesis genesis > "${TMP}/postgres.sql" \
    || die "pg_dump 失败（数据库未启动？）"

  log "导出 volumes..."
  for vol in $("${DC[@]}" config --volumes 2>/dev/null); do
    docker run --rm \
      -v "$(basename "$PWD" | tr -cd '[:alnum:]')_${vol}:/data" \
      -v "${TMP}:/out" \
      alpine tar czf "/out/${vol}.tar.gz" -C /data . 2>/dev/null \
      || warn "卷 ${vol} 不存在或为空，跳过"
  done

  log "压缩备份包..."
  cp .env.production "${TMP}/env.production.encrypted-please"
  echo "$(cat VERSION 2>/dev/null || echo unknown)" > "${TMP}/VERSION"
  tar -czf "$FILE" -C "$TMP" .

  local SIZE SHA
  SIZE="$(du -h "$FILE" | awk '{print $1}')"
  SHA="$(sha256sum "$FILE" 2>/dev/null | awk '{print $1}' || echo skipped)"

  cat <<EOF

${C_BOLD}${C_GREEN}✓ 备份完成${C_RESET}
  文件 : ${FILE}
  大小 : ${SIZE}
  SHA-256 : ${SHA}

${C_YELLOW}!!${C_RESET} 备份含明文 .env.production（数据库密码 / JWT secret / 加密 key）
   建议加密后异地存放：${C_DIM}gpg --symmetric ${FILE}${C_RESET}
EOF
}

cmd_restore() {
  local BACKUP="${1:-}"
  [ -n "$BACKUP" ] || die "用法：bash genesis.sh restore <backup.tar.gz>"
  [ -f "$BACKUP" ] || die "找不到备份文件：$BACKUP"

  warn "${C_BOLD}!! 警告 !!${C_RESET} 还原将覆盖当前数据库和 volumes，所有现有数据会丢失"
  read -r -p "  确认还原? 输入 RESTORE 以继续: " ANS
  [ "$ANS" = "RESTORE" ] || die "已取消"

  detect_dc

  local TMP
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  log "解包备份..."
  tar -xzf "$BACKUP" -C "$TMP"

  log "停止当前服务..."
  "${DC[@]}" stop

  log "恢复 PostgreSQL..."
  [ -f "${TMP}/postgres.sql" ] || die "备份缺少 postgres.sql"
  "${DC[@]}" start postgres
  sleep 5
  "${DC[@]}" exec -T postgres dropdb -U genesis genesis --if-exists 2>/dev/null || true
  "${DC[@]}" exec -T postgres createdb -U genesis genesis
  "${DC[@]}" exec -T postgres psql -U genesis genesis < "${TMP}/postgres.sql"

  log "恢复 volumes..."
  for tarball in "${TMP}"/*.tar.gz; do
    [ -f "$tarball" ] || continue
    local vol
    vol="$(basename "$tarball" .tar.gz)"
    [ "$vol" = "$(basename "$BACKUP" .tar.gz)" ] && continue  # 跳过自身
    docker run --rm \
      -v "$(basename "$PWD" | tr -cd '[:alnum:]')_${vol}:/data" \
      -v "${TMP}:/in" \
      alpine sh -c "cd /data && tar xzf /in/${vol}.tar.gz" 2>/dev/null \
      || warn "卷 ${vol} 还原失败，跳过"
  done

  log "重启全栈..."
  "${DC[@]}" --env-file .env.production up -d

  log "还原完成；用 bash genesis.sh status 看健康度"
}

cmd_check_update() {
  [ -f IMAGES ] || die "当前目录无 IMAGES 文件；请在已安装的 install 目录里运行"
  [ -f VERSION ] || die "当前目录无 VERSION 文件"

  grep -q "ghcr.io" "${HOME}/.docker/config.json" 2>/dev/null \
    || die "未检测到 ghcr.io 登录凭据；请先 docker login ghcr.io"

  local CURRENT_VERSION INSTALLER_BASE INSTALLER_LATEST LATEST_VERSION
  CURRENT_VERSION="$(cat VERSION)"
  INSTALLER_BASE="$(head -1 IMAGES | sed 's|/[^/]*:[^/]*$||')/genesis-installer"
  INSTALLER_LATEST="${INSTALLER_BASE}:latest"

  log "拉取 ${INSTALLER_LATEST} 检查最新版本..."
  docker pull "$INSTALLER_LATEST" >/dev/null 2>&1 \
    || die "拉取失败；检查网络 / ghcr 权限 / installer:latest 是否已发布"

  # 注：路径前置双斜杠避免 git bash 在 Windows 上路径翻译；Linux 兼容
  LATEST_VERSION="$(docker run --rm --entrypoint cat "$INSTALLER_LATEST" //bundle/VERSION 2>/dev/null || echo unknown)"

  echo
  echo "  当前版本: ${C_DIM}${CURRENT_VERSION}${C_RESET}"
  echo "  最新版本: ${C_BOLD}${LATEST_VERSION}${C_RESET}"
  echo

  if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    log "已是最新版本"
  elif [ "$LATEST_VERSION" = "unknown" ]; then
    warn "无法识别 installer:latest 里的 VERSION 文件"
  else
    log "有新版本可用，运行：${C_BOLD}bash genesis.sh upgrade ${LATEST_VERSION}${C_RESET}"
  fi
}

cmd_status() {
  detect_dc
  echo
  echo "${C_BOLD}容器状态${C_RESET}"
  "${DC[@]}" ps 2>/dev/null || die "compose 未启动？"

  echo
  echo "${C_BOLD}健康检查${C_RESET}"
  for c in genesis-postgres genesis-redis genesis-backend genesis-frontend genesis-ai-service genesis-flaresolverr; do
    local h
    h="$(docker inspect "$c" --format '{{.State.Health.Status}}' 2>/dev/null || echo 'no-healthcheck')"
    local s
    s="$(docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null || echo 'not-found')"
    printf "  %-30s status=%-10s health=%s\n" "$c" "$s" "$h"
  done

  echo
  echo "${C_BOLD}关键端点${C_RESET}"
  if docker exec genesis-backend curl -sf http://localhost:4000/health >/dev/null 2>&1; then
    echo "  ${C_GREEN}✓${C_RESET} backend /health"
  else
    echo "  ${C_RED}✗${C_RESET} backend /health"
  fi

  echo
}

cmd_logs() {
  detect_dc
  local SVC="${1:-backend}"
  "${DC[@]}" logs -f "$SVC"
}

cmd_uninstall() {
  warn "${C_BOLD}!! 警告 !!${C_RESET} 拆卸会删除："
  warn "  - 所有容器（genesis-*）"
  warn "  - 所有 docker volumes（postgres_data / redis_data / backend_thumbnails / backend_exports）"
  warn "  - ${SCRIPT_DIR}/.env.production 及 .env.production.bak.*"
  warn "  - ghcr.io docker logout（其他项目登录不受影响）"
  warn "${C_BOLD}所有数据将不可恢复，除非你之前跑过 bash genesis.sh backup${C_RESET}"
  echo
  read -r -p "  确认拆卸? 输入 DELETE 以继续: " ANS
  [ "$ANS" = "DELETE" ] || die "已取消"

  detect_dc

  log "停止并删除容器 + volumes..."
  "${DC[@]}" --env-file .env.production down -v 2>&1 | tail -10 || true

  log "删除 .env.production 和备份..."
  rm -f .env.production .env.production.bak.*

  log "docker logout ghcr.io..."
  docker logout ghcr.io 2>/dev/null || true

  echo
  echo "${C_BOLD}${C_GREEN}✓ 拆卸完成${C_RESET}"
  echo
  echo "  ${C_DIM}配置目录 ${SCRIPT_DIR} 本身未删；如不再需要：cd / && rm -rf ${SCRIPT_DIR}${C_RESET}"
  echo "  ${C_DIM}镜像本地仍存（不占网络）；如要清：docker image prune -a${C_RESET}"
}

cmd_help() {
  grep '^#' "$0" | sed 's/^# \?//' | head -28
  echo
  echo "完整运维手册：${C_BOLD}https://github.com/genesis-release/docs${C_RESET}"
  echo "本地副本    ：${C_BOLD}./CUSTOMER-GUIDE.md${C_RESET}"
}

# ── 主分发 ────────────────────────────────────────────────
CMD="${1:-help}"
shift || true

case "$CMD" in
  preflight)    cmd_preflight "$@" ;;
  install)      cmd_install "$@" ;;
  upgrade)      cmd_upgrade "$@" ;;
  check-update) cmd_check_update "$@" ;;
  backup)       cmd_backup "$@" ;;
  restore)      cmd_restore "$@" ;;
  status)       cmd_status "$@" ;;
  logs)         cmd_logs "$@" ;;
  uninstall)    cmd_uninstall "$@" ;;
  help|-h|--help) cmd_help ;;
  *) warn "未知命令：$CMD"; cmd_help; exit 1 ;;
esac
