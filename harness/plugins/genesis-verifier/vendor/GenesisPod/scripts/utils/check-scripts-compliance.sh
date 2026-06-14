#!/bin/bash
#
# 脚本规范合规检查
# 根据 .claude/standards/12-scripts-management.md 规范检查脚本目录
#
# 使用方法:
#   ./scripts/utils/check-scripts-compliance.sh
#   ./scripts/utils/check-scripts-compliance.sh --fix  # 自动修复可修复的问题
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 统计
ERRORS=0
WARNINGS=0
FIX_MODE=false

# 解析参数
if [ "$1" == "--fix" ]; then
  FIX_MODE=true
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  脚本规范合规检查${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 获取项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$PROJECT_ROOT"

# ==========================================
# 1. 检查 fix-* 脚本在活跃目录
# ==========================================
echo -e "${BLUE}[1/5] 检查需要归档的 fix-* 脚本...${NC}"

FIX_SCRIPTS=$(find scripts/ backend/scripts/ -maxdepth 2 -name "fix-*" ! -path "*/_archive/*" 2>/dev/null || true)
if [ -n "$FIX_SCRIPTS" ]; then
  echo -e "${RED}❌ 发现需要归档的 fix-* 脚本:${NC}"
  echo "$FIX_SCRIPTS" | while read -r f; do
    echo "   - $f"
  done
  ((ERRORS++)) || true

  if [ "$FIX_MODE" == "true" ]; then
    echo -e "${YELLOW}   自动归档...${NC}"
    DATE=$(date +%Y-%m)
    echo "$FIX_SCRIPTS" | while read -r f; do
      if [[ "$f" == scripts/* ]]; then
        mkdir -p scripts/_archive/fixes
        mv "$f" "scripts/_archive/fixes/${DATE}-$(basename "$f")"
        echo "   ✓ 已归档: $f"
      elif [[ "$f" == backend/scripts/* ]]; then
        mkdir -p backend/scripts/_archive
        mv "$f" "backend/scripts/_archive/${DATE}-$(basename "$f")"
        echo "   ✓ 已归档: $f"
      fi
    done
  fi
else
  echo -e "${GREEN}✅ 无需要归档的 fix-* 脚本${NC}"
fi
echo ""

# ==========================================
# 2. 检查 migrate-* 脚本在活跃目录
# ==========================================
echo -e "${BLUE}[2/5] 检查需要归档的 migrate-* 脚本...${NC}"

MIGRATE_SCRIPTS=$(find scripts/ backend/scripts/ -maxdepth 2 -name "migrate-*" ! -path "*/_archive/*" 2>/dev/null || true)
if [ -n "$MIGRATE_SCRIPTS" ]; then
  echo -e "${RED}❌ 发现需要归档的 migrate-* 脚本:${NC}"
  echo "$MIGRATE_SCRIPTS" | while read -r f; do
    echo "   - $f"
  done
  ((ERRORS++)) || true

  if [ "$FIX_MODE" == "true" ]; then
    echo -e "${YELLOW}   自动归档...${NC}"
    DATE=$(date +%Y-%m)
    echo "$MIGRATE_SCRIPTS" | while read -r f; do
      if [[ "$f" == scripts/* ]]; then
        mkdir -p scripts/_archive/migrations
        mv "$f" "scripts/_archive/migrations/${DATE}-$(basename "$f")"
        echo "   ✓ 已归档: $f"
      fi
    done
  fi
else
  echo -e "${GREEN}✅ 无需要归档的 migrate-* 脚本${NC}"
fi
echo ""

# ==========================================
# 3. 检查临时文件
# ==========================================
echo -e "${BLUE}[3/5] 检查临时文件...${NC}"

TEMP_FILES=$(find scripts/ backend/scripts/ \( -name "*.tmp" -o -name "*.bak" -o -name "temp*" \) 2>/dev/null || true)
if [ -n "$TEMP_FILES" ]; then
  echo -e "${YELLOW}⚠️ 发现临时文件:${NC}"
  echo "$TEMP_FILES" | while read -r f; do
    echo "   - $f"
  done
  ((WARNINGS++)) || true
else
  echo -e "${GREEN}✅ 无临时文件${NC}"
fi
echo ""

# ==========================================
# 4. 检查目录结构
# ==========================================
echo -e "${BLUE}[4/5] 检查目录结构...${NC}"

REQUIRED_DIRS=(
  "scripts/_archive/fixes"
  "scripts/_archive/migrations"
  "scripts/utils"
  "backend/scripts/_archive"
)

MISSING_DIRS=()
for dir in "${REQUIRED_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    MISSING_DIRS+=("$dir")
  fi
done

if [ ${#MISSING_DIRS[@]} -gt 0 ]; then
  echo -e "${YELLOW}⚠️ 缺失目录:${NC}"
  for dir in "${MISSING_DIRS[@]}"; do
    echo "   - $dir"
  done
  ((WARNINGS++)) || true

  if [ "$FIX_MODE" == "true" ]; then
    echo -e "${YELLOW}   自动创建...${NC}"
    for dir in "${MISSING_DIRS[@]}"; do
      mkdir -p "$dir"
      echo "   ✓ 已创建: $dir"
    done
  fi
else
  echo -e "${GREEN}✅ 目录结构完整${NC}"
fi

# 检查 README.md
if [ ! -f "scripts/README.md" ]; then
  echo -e "${YELLOW}⚠️ 缺失: scripts/README.md${NC}"
  ((WARNINGS++)) || true
else
  echo -e "${GREEN}✅ scripts/README.md 存在${NC}"
fi
echo ""

# ==========================================
# 5. 检查过期归档 (超过 6 个月)
# ==========================================
echo -e "${BLUE}[5/5] 检查过期归档...${NC}"

OLD_ARCHIVES=$(find scripts/_archive backend/scripts/_archive -type f -mtime +180 2>/dev/null || true)
if [ -n "$OLD_ARCHIVES" ]; then
  echo -e "${YELLOW}⚠️ 发现超过 6 个月的归档文件:${NC}"
  echo "$OLD_ARCHIVES" | while read -r f; do
    echo "   - $f"
  done
  echo "   建议：考虑删除这些过期归档"
  ((WARNINGS++)) || true
else
  echo -e "${GREEN}✅ 无过期归档${NC}"
fi
echo ""

# ==========================================
# 总结
# ==========================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  检查完成${NC}"
echo -e "${BLUE}========================================${NC}"

if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}❌ 错误: $ERRORS${NC}"
fi
if [ $WARNINGS -gt 0 ]; then
  echo -e "${YELLOW}⚠️ 警告: $WARNINGS${NC}"
fi

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✅ 所有检查通过！脚本目录符合规范。${NC}"
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}⚠️ 有警告，但无严重问题。${NC}"
  exit 0
else
  echo -e "${RED}❌ 存在需要处理的问题。${NC}"
  if [ "$FIX_MODE" != "true" ]; then
    echo ""
    echo "提示：使用 --fix 参数可自动修复部分问题："
    echo "  ./scripts/utils/check-scripts-compliance.sh --fix"
  fi
  exit 1
fi
