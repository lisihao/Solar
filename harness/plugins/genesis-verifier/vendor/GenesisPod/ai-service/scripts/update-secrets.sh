#!/bin/bash
# 更新 GCP Secret Manager 中的 API 密钥

PROJECT_ID="genesis-ai"

echo "==================================="
echo "更新 GCP Secret Manager API 密钥"
echo "==================================="
echo ""

# 更新 OpenAI API Key
echo "请输入你的 OpenAI API Key (从 https://platform.openai.com/api-keys 获取):"
read -s OPENAI_KEY

if [ -z "$OPENAI_KEY" ]; then
    echo "❌ OpenAI API Key 不能为空"
    exit 1
fi

echo "正在更新 openai-api-key..."
echo -n "$OPENAI_KEY" | gcloud secrets versions add openai-api-key \
    --data-file=- \
    --project=$PROJECT_ID

if [ $? -eq 0 ]; then
    echo "✅ openai-api-key 更新成功"
else
    echo "❌ openai-api-key 更新失败"
    exit 1
fi

echo ""
echo "==================================="
echo "验证更新"
echo "==================================="

# 验证 Grok API Key
echo "Grok API Key:"
gcloud secrets versions access latest --secret="grok-api-key" --project=$PROJECT_ID | head -c 20
echo "..."

# 验证 OpenAI API Key
echo ""
echo "OpenAI API Key:"
gcloud secrets versions access latest --secret="openai-api-key" --project=$PROJECT_ID | head -c 20
echo "..."

echo ""
echo "✅ 所有密钥已更新！请重启 AI 服务。"
