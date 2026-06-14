#!/bin/sh
# GenesisPod installer 镜像 entrypoint
# 把 /bundle/ 拷贝到挂载的 /out/genesis-config-<version>/

set -e

if [ ! -d /out ]; then
  echo "ERROR: 必须挂载宿主机目录到 /out"
  echo "用法：docker run --rm -v \"\$(pwd):/out\" ghcr.io/genesis-release/genesis-installer:VERSION"
  exit 1
fi

VERSION="$(cat /bundle/VERSION 2>/dev/null || echo unknown)"
TARGET_DIR="/out/genesis-config-${VERSION}"

if [ -d "$TARGET_DIR" ] && [ "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
  echo "WARNING: ${TARGET_DIR} 已存在且非空，跳过解压"
  echo "如需重新解压，先删除该目录"
  exit 0
fi

mkdir -p "$TARGET_DIR"
cp -r /bundle/. "$TARGET_DIR/"
chmod +x "$TARGET_DIR"/*.sh 2>/dev/null || true

cat <<EOF

✓ GenesisPod 配置已解压到：${TARGET_DIR}

下一步：
  cd genesis-config-${VERSION}
  bash genesis.sh install
EOF
