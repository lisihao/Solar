#!/usr/bin/env bash
# install.sh — alias to `genesis.sh install` (保留兼容；新代码请直接用 genesis.sh)
exec bash "$(dirname "$0")/genesis.sh" install "$@"
