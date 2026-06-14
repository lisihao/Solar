"""
OpenAI API 客户端
"""
from typing import Optional
from loguru import logger
from openai import AsyncOpenAI


class OpenAIClient:
    """OpenAI API 客户端"""

    def __init__(self, api_key: Optional[str] = None):
        """
        初始化 OpenAI 客户端

        Args:
            api_key: OpenAI API 密钥
        """
        self.api_key = api_key
        self.available = bool(api_key)

        if not self.available:
            logger.warning("OpenAI API key not available")
        else:
            self.client = AsyncOpenAI(api_key=api_key)
            logger.info("OpenAI client initialized")

    async def generate_completion(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        model: str = "gpt-4o-mini"
    ) -> Optional[str]:
        """
        生成文本补全

        Args:
            prompt: 提示词
            max_tokens: 最大 token 数
            temperature: 温度参数
            model: 模型名称

        Returns:
            生成的文本，失败返回 None
        """
        if not self.available:
            logger.error("OpenAI client not available")
            return None

        try:
            response = await self.client.chat.completions.create(
                model=model,  # 使用指定模型 (默认 gpt-4o-mini)
                messages=[
                    {"role": "user", "content": prompt}
                ],
                max_tokens=max_tokens,
                temperature=temperature,
            )

            return response.choices[0].message.content

        except Exception as e:
            logger.error(f"OpenAI API exception: {str(e)}")
            return None

    async def stream_completion(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7
    ):
        """
        流式生成文本补全

        Args:
            prompt: 提示词
            max_tokens: 最大 token 数
            temperature: 温度参数

        Yields:
            生成的文本片段
        """
        if not self.available:
            logger.error("OpenAI client not available")
            return

        try:
            stream = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "user", "content": prompt}
                ],
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True,
            )

            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

        except Exception as e:
            logger.error(f"OpenAI streaming exception: {str(e)}")

    async def chat(
        self,
        messages: list,
        model: str = "gpt-4",
        max_tokens: int = 500,
        temperature: float = 0.7
    ) -> Optional[str]:
        """
        使用messages格式进行对话

        Args:
            messages: 消息列表
            model: 模型名称
            max_tokens: 最大 token 数
            temperature: 温度参数

        Returns:
            AI回复内容
        """
        if not self.available:
            logger.error("OpenAI client not available")
            return None

        try:
            response = await self.client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )

            return response.choices[0].message.content

        except Exception as e:
            logger.error(f"OpenAI chat exception: {str(e)}")
            return None

    async def health_check(self) -> bool:
        """
        健康检查

        Returns:
            是否可用
        """
        if not self.available:
            return False

        try:
            result = await self.generate_completion("Hello", max_tokens=10)
            return result is not None
        except Exception as e:
            logger.error(f"OpenAI health check failed: {str(e)}")
            return False
