#!/usr/bin/env bash
# upgrade.sh — alias to `genesis.sh upgrade` (保留兼容；新代码请直接用 genesis.sh)
exec bash "$(dirname "$0")/genesis.sh" upgrade "$@"
