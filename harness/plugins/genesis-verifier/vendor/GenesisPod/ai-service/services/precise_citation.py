"""
精确引用服务 - RAG 引用精确化
实现段落级引用、置信度评估、引用验证
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum
import re
import hashlib


class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


@dataclass
class PreciseCitation:
    """精确引用"""
    citation_id: str
    source_id: str
    source_title: str
    paragraph_index: int
    exact_quote: str
    confidence: ConfidenceLevel
    verifiable: bool
    hover_preview: str
    source_url: Optional[str] = None


@dataclass
class CitationMetrics:
    """引用质量指标"""
    grounded_ratio: float  # 有据可查比例
    source_count: int  # 引用源数量
    verified_count: int  # 已验证引用数
    overall_confidence: ConfidenceLevel


@dataclass
class ResponseWithCitations:
    """带引用的回答"""
    content: str
    citations: List[PreciseCitation]
    metrics: CitationMetrics
    raw_response: Optional[str] = None


@dataclass
class Paragraph:
    """资源段落"""
    source_id: str
    source_title: str
    source_url: str
    paragraph_index: int
    text: str
    embedding: Optional[List[float]] = None


class PreciseCitationService:
    """精确引用服务"""

    def __init__(self, ai_client=None):
        self.ai_client = ai_client

    def split_into_paragraphs(self, resource: Dict[str, Any]) -> List[Paragraph]:
        """将资源分割为段落"""
        content = resource.get("content", "") or resource.get("abstract", "")
        if not content:
            return []

        # 按双换行分割段落
        raw_paragraphs = re.split(r'\n\s*\n', content)

        paragraphs = []
        for i, text in enumerate(raw_paragraphs):
            text = text.strip()
            if len(text) < 30:  # 过滤太短的段落
                continue

            paragraphs.append(Paragraph(
                source_id=resource.get("id", ""),
                source_title=resource.get("title", "Unknown"),
                source_url=resource.get("sourceUrl", ""),
                paragraph_index=i,
                text=text
            ))

        return paragraphs

    def calculate_text_similarity(self, text1: str, text2: str) -> float:
        """计算文本相似度 (Jaccard)"""
        if not text1 or not text2:
            return 0.0

        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())

        intersection = words1 & words2
        union = words1 | words2

        if not union:
            return 0.0

        return len(intersection) / len(union)

    def verify_citation(self, claim: str, source_text: str, threshold: float = 0.3) -> bool:
        """验证引用是否真实存在于原文"""
        if not claim or not source_text:
            return False

        # 计算词汇重叠
        similarity = self.calculate_text_similarity(claim, source_text)
        return similarity >= threshold

    def extract_key_phrases(self, text: str, max_phrases: int = 5) -> List[str]:
        """提取关键短语"""
        # 简单实现：提取较长的词组
        words = text.split()
        phrases = []

        for i in range(len(words) - 2):
            phrase = " ".join(words[i:i+3])
            if len(phrase) > 10:
                phrases.append(phrase.lower())

        return phrases[:max_phrases]

    def find_best_matching_paragraph(
        self,
        query: str,
        paragraphs: List[Paragraph]
    ) -> Optional[Paragraph]:
        """找到最匹配的段落"""
        if not paragraphs:
            return None

        best_match = None
        best_score = 0.0

        for para in paragraphs:
            score = self.calculate_text_similarity(query, para.text)
            if score > best_score:
                best_score = score
                best_match = para

        return best_match if best_score > 0.1 else None

    def rank_paragraphs_by_relevance(
        self,
        query: str,
        paragraphs: List[Paragraph],
        top_k: int = 10
    ) -> List[Paragraph]:
        """按相关性排序段落"""
        scored = []
        for para in paragraphs:
            score = self.calculate_text_similarity(query, para.text)
            scored.append((score, para))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [para for _, para in scored[:top_k]]

    def build_context_with_citations(
        self,
        paragraphs: List[Paragraph]
    ) -> str:
        """构建带编号的上下文"""
        context_parts = []
        for i, para in enumerate(paragraphs, 1):
            context_parts.append(f"[{i}] ({para.source_title})\n{para.text}\n")

        return "\n".join(context_parts)

    def parse_citations_from_response(
        self,
        response: str,
        paragraphs: List[Paragraph]
    ) -> List[PreciseCitation]:
        """从回答中解析引用"""
        citations = []
        seen_indices = set()

        # 匹配 [1], [2] 等格式
        citation_pattern = r'\[(\d+)\]'
        matches = re.findall(citation_pattern, response)

        for match in matches:
            idx = int(match) - 1
            if idx in seen_indices or idx < 0 or idx >= len(paragraphs):
                continue

            seen_indices.add(idx)
            para = paragraphs[idx]

            # 提取引用周围的文本作为声明
            claim = self._extract_claim_around_citation(response, match)

            # 验证引用
            verifiable = self.verify_citation(claim, para.text)

            # 确定置信度
            if verifiable:
                confidence = ConfidenceLevel.HIGH
            elif self.calculate_text_similarity(claim, para.text) > 0.2:
                confidence = ConfidenceLevel.MEDIUM
            else:
                confidence = ConfidenceLevel.LOW

            # 生成预览
            preview_text = para.text[:300] + "..." if len(para.text) > 300 else para.text

            citation = PreciseCitation(
                citation_id=hashlib.md5(f"{para.source_id}:{para.paragraph_index}".encode()).hexdigest()[:8],
                source_id=para.source_id,
                source_title=para.source_title,
                paragraph_index=para.paragraph_index,
                exact_quote=preview_text,
                confidence=confidence,
                verifiable=verifiable,
                hover_preview=f"来源: {para.source_title}\n\n{preview_text}",
                source_url=para.source_url
            )
            citations.append(citation)

        return citations

    def _extract_claim_around_citation(self, text: str, citation_num: str) -> str:
        """提取引用周围的声明文本"""
        pattern = rf'([^.!?]*\[{citation_num}\][^.!?]*[.!?]?)'
        match = re.search(pattern, text)
        if match:
            return match.group(1).strip()
        return ""

    def calculate_metrics(self, citations: List[PreciseCitation]) -> CitationMetrics:
        """计算引用质量指标"""
        if not citations:
            return CitationMetrics(
                grounded_ratio=0.0,
                source_count=0,
                verified_count=0,
                overall_confidence=ConfidenceLevel.LOW
            )

        verified_count = sum(1 for c in citations if c.verifiable)
        grounded_ratio = verified_count / len(citations)
        source_ids = set(c.source_id for c in citations)

        if grounded_ratio >= 0.8:
            overall = ConfidenceLevel.HIGH
        elif grounded_ratio >= 0.5:
            overall = ConfidenceLevel.MEDIUM
        else:
            overall = ConfidenceLevel.LOW

        return CitationMetrics(
            grounded_ratio=grounded_ratio,
            source_count=len(source_ids),
            verified_count=verified_count,
            overall_confidence=overall
        )

    async def generate_with_citations(
        self,
        query: str,
        resources: List[Dict[str, Any]],
        max_paragraphs: int = 15
    ) -> ResponseWithCitations:
        """生成带精确引用的回答"""

        # 1. 将所有资源分割为段落
        all_paragraphs = []
        for resource in resources:
            paragraphs = self.split_into_paragraphs(resource)
            all_paragraphs.extend(paragraphs)

        if not all_paragraphs:
            return ResponseWithCitations(
                content="没有找到足够的资料来回答这个问题。",
                citations=[],
                metrics=CitationMetrics(0.0, 0, 0, ConfidenceLevel.LOW)
            )

        # 2. 按相关性排序并选取
        relevant_paragraphs = self.rank_paragraphs_by_relevance(
            query, all_paragraphs, top_k=max_paragraphs
        )

        # 3. 构建上下文
        context = self.build_context_with_citations(relevant_paragraphs)

        # 4. 构建提示词
        prompt = f"""基于以下资料回答问题。请严格遵循以下规则：

1. 只使用提供的资料，不要编造信息
2. 对每个关键论述，用 [数字] 标注来源（如 [1], [2]）
3. 如果资料不足以回答，请明确说明"根据现有资料无法确定"
4. 优先使用高质量来源

资料：
{context}

问题：{query}

请用中文回答，并确保标注引用来源。"""

        # 5. 调用 AI 生成回答
        if self.ai_client:
            response = await self.ai_client.generate(prompt)
        else:
            response = f"[模拟回答] 基于 {len(relevant_paragraphs)} 个段落的分析..."

        # 6. 解析引用
        citations = self.parse_citations_from_response(response, relevant_paragraphs)

        # 7. 计算指标
        metrics = self.calculate_metrics(citations)

        return ResponseWithCitations(
            content=response,
            citations=citations,
            metrics=metrics,
            raw_response=response
        )

    def format_citations_for_display(self, citations: List[PreciseCitation]) -> List[Dict]:
        """格式化引用供前端显示"""
        return [
            {
                "id": c.citation_id,
                "sourceId": c.source_id,
                "sourceTitle": c.source_title,
                "paragraphIndex": c.paragraph_index,
                "exactQuote": c.exact_quote,
                "confidence": c.confidence.value,
                "verifiable": c.verifiable,
                "hoverPreview": c.hover_preview,
                "sourceUrl": c.source_url
            }
            for c in citations
        ]

    def format_response_for_api(self, response: ResponseWithCitations) -> Dict:
        """格式化完整响应供 API 返回"""
        return {
            "content": response.content,
            "citations": self.format_citations_for_display(response.citations),
            "metrics": {
                "groundedRatio": response.metrics.grounded_ratio,
                "sourceCount": response.metrics.source_count,
                "verifiedCount": response.metrics.verified_count,
                "overallConfidence": response.metrics.overall_confidence.value
            }
        }
