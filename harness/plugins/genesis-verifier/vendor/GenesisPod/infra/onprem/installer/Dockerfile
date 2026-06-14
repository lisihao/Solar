# GenesisPod 客户侧 installer 镜像
#
# 一个 ~6MB 的"配置传输容器"：把 docker-compose.yml / 脚本 / README
# 烤进镜像，客户 docker pull + docker run 就能把它们"倒"到本地目录。
# 替代邮件发 tar.gz 的交付方式；客户全程只需要 ghcr.io 凭据。
#
# Build 由 infra/onprem/scripts/build-bundle.sh 调起，会预生成 staging
# 目录（含 VERSION / IMAGES / entrypoint.sh），所以这个 Dockerfile 只 COPY
# 一个目录就够，不依赖 build-arg。
#
# 客户用法：
#   docker run --rm -v "$(pwd):/out" ghcr.io/genesis-release/genesis-installer:vX.Y.Z

FROM alpine:3.20

LABEL org.opencontainers.image.source="https://github.com/genesis-agents/GenesisPod"
LABEL org.opencontainers.image.description="GenesisPod on-prem installer (extracts compose + scripts to host)"
LABEL org.opencontainers.image.licenses="Proprietary"

# build context 是 staging 目录，含 7 个客户文件 + entrypoint.sh
COPY bundle/ /bundle/
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /bundle/genesis.sh /bundle/install.sh /bundle/upgrade.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
