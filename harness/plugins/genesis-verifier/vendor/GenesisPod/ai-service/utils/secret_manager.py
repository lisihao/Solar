"""
密钥管理器 - 从 GCP Secret Manager 或环境变量获取 API 密钥
"""
import os
from typing import Optional
from loguru import logger


class SecretManager:
    """密钥管理器 - 支持 GCP Secret Manager"""

    def __init__(self):
        """初始化密钥管理器"""
        self.gcp_project_id = os.getenv("GCP_PROJECT_ID")
        self.use_gcp = os.getenv("USE_GCP_SECRET_MANAGER", "false").lower() == "true"

        # 尝试导入 GCP Secret Manager 客户端
        self.gcp_client = None
        if self.use_gcp:
            try:
                from google.cloud import secretmanager
                self.gcp_client = secretmanager.SecretManagerServiceClient()
                logger.info(f"GCP Secret Manager initialized (project: {self.gcp_project_id})")
            except ImportError:
                logger.warning("google-cloud-secret-manager not installed, falling back to environment variables")
                self.use_gcp = False
            except Exception as e:
                logger.warning(f"Failed to initialize GCP Secret Manager: {e}, falling back to environment variables")
                self.use_gcp = False
        else:
            logger.info("Using environment variables for secrets")

    def get_secret_from_gcp(self, secret_name: str) -> Optional[str]:
        """
        从 GCP Secret Manager 获取密钥

        Args:
            secret_name: 密钥名称

        Returns:
            密钥值，如果不存在则返回 None
        """
        if not self.gcp_client or not self.gcp_project_id:
            return None

        try:
            # 构建密钥资源名称
            name = f"projects/{self.gcp_project_id}/secrets/{secret_name}/versions/latest"

            # 访问密钥
            response = self.gcp_client.access_secret_version(request={"name": name})
            secret_value = response.payload.data.decode("UTF-8").strip()

            logger.info(f"Retrieved secret {secret_name} from GCP Secret Manager")
            return secret_value
        except Exception as e:
            logger.error(f"Failed to get secret {secret_name} from GCP: {e}")
            return None

    def get_secret(self, key: str) -> Optional[str]:
        """
        获取密钥（优先从 GCP Secret Manager，回退到环境变量）

        Args:
            key: 密钥名称

        Returns:
            密钥值，如果不存在则返回 None
        """
        # 1. 尝试从 GCP Secret Manager 获取
        if self.use_gcp:
            value = self.get_secret_from_gcp(key)
            if value:
                return value

        # 2. 回退到环境变量
        value = os.getenv(key)

        if value and value.startswith("your_") and value.endswith("_here"):
            # 这是占位符，不是真实密钥
            logger.warning(f"Secret {key} is a placeholder, please set real value")
            return None

        if value:
            logger.info(f"Retrieved secret {key} from environment variable")

        return value

    def get_grok_api_key(self) -> Optional[str]:
        """获取 Grok API 密钥"""
        # GCP Secret Manager 使用连字符，环境变量使用下划线
        if self.use_gcp:
            return self.get_secret_from_gcp("grok-api-key") or self.get_secret("GROK_API_KEY")
        return self.get_secret("GROK_API_KEY")

    def get_openai_api_key(self) -> Optional[str]:
        """获取 OpenAI API 密钥"""
        # GCP Secret Manager 使用连字符，环境变量使用下划线
        if self.use_gcp:
            return self.get_secret_from_gcp("openai-api-key") or self.get_secret("OPENAI_API_KEY")
        return self.get_secret("OPENAI_API_KEY")


# 全局单例
secret_manager = SecretManager()
