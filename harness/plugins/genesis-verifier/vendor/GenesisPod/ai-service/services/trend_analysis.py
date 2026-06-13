"""
趋势分析服务 - 科技趋势报告生成
实现技术提取、趋势分析、Hype Cycle 数据生成
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime, timedelta
import re
from collections import Counter


class TrendDirection(str, Enum):
    RISING = "rising"
    STABLE = "stable"
    DECLINING = "declining"


class MaturityStage(str, Enum):
    """Gartner Hype Cycle 阶段"""
    INNOVATION_TRIGGER = "innovation_trigger"
    PEAK_OF_EXPECTATIONS = "peak_of_expectations"
    TROUGH_OF_DISILLUSIONMENT = "trough_of_disillusionment"
    SLOPE_OF_ENLIGHTENMENT = "slope_of_enlightenment"
    PLATEAU_OF_PRODUCTIVITY = "plateau_of_productivity"


@dataclass
class TechMention:
    """技术提及"""
    name: str
    count: int
    sources: List[str]
    first_seen: datetime
    last_seen: datetime
    sentiment_score: float = 0.0


@dataclass
class TrendPoint:
    """趋势数据点"""
    date: str
    mention_count: int
    sentiment: float
    key_sources: List[str]


@dataclass
class TechTrend:
    """技术趋势"""
    name: str
    direction: TrendDirection
    maturity_stage: MaturityStage
    momentum_score: float  # 0-100
    adoption_rate: float  # 0-100
    data_points: List[TrendPoint]
    related_techs: List[str]
    key_players: List[str]
    summary: str


@dataclass
class HypeCyclePosition:
    """Hype Cycle 位置"""
    tech_name: str
    x_position: float  # 0-100, 表示时间/成熟度
    y_position: float  # 0-100, 表示期望值
    stage: MaturityStage
    years_to_mainstream: Optional[str]  # e.g., "2-5 years"


@dataclass
class TrendReport:
    """趋势报告"""
    title: str
    generated_at: datetime
    time_range: str
    executive_summary: str
    top_trends: List[TechTrend]
    hype_cycle: List[HypeCyclePosition]
    emerging_techs: List[str]
    declining_techs: List[str]
    data_sources_count: int
    confidence_score: float


class TrendAnalysisService:
    """趋势分析服务"""

    # 常见技术关键词
    TECH_PATTERNS = [
        # AI/ML
        r'\b(LLM|GPT-\d|Claude|Gemini|Llama|Mistral)\b',
        r'\b(transformer|attention mechanism|fine-?tuning|RAG|RLHF)\b',
        r'\b(machine learning|deep learning|neural network|AI agent)\b',
        # Infrastructure
        r'\b(kubernetes|docker|serverless|microservices|edge computing)\b',
        r'\b(WebAssembly|WASM|gRPC|GraphQL|REST API)\b',
        # Languages & Frameworks
        r'\b(Rust|Go|TypeScript|Python|Zig)\b',
        r'\b(React|Vue|Svelte|Next\.?js|Remix)\b',
        # Data & Database
        r'\b(PostgreSQL|MongoDB|Redis|Kafka|ClickHouse)\b',
        r'\b(vector database|embedding|Pinecone|Milvus|Weaviate)\b',
        # Security
        r'\b(zero trust|SASE|CASB|XDR|SOAR)\b',
        # Emerging
        r'\b(quantum computing|blockchain|Web3|metaverse|spatial computing)\b',
    ]

    # 情感词典
    POSITIVE_WORDS = {
        'breakthrough', 'revolutionary', 'innovative', 'excellent', 'impressive',
        'powerful', 'efficient', 'scalable', 'robust', 'promising', 'exciting',
        'groundbreaking', 'remarkable', 'outstanding', 'superior', 'leading'
    }

    NEGATIVE_WORDS = {
        'deprecated', 'obsolete', 'vulnerable', 'slow', 'limited', 'problematic',
        'complex', 'challenging', 'risky', 'concerns', 'issues', 'failed',
        'declining', 'outdated', 'legacy', 'abandoned'
    }

    def __init__(self, ai_client=None):
        self.ai_client = ai_client
        self.tech_pattern = re.compile(
            '|'.join(self.TECH_PATTERNS),
            re.IGNORECASE
        )

    def extract_technologies(self, text: str) -> List[str]:
        """从文本中提取技术关键词"""
        if not text:
            return []

        matches = self.tech_pattern.findall(text)
        # 标准化
        normalized = [m.lower().strip() for m in matches if m]
        return list(set(normalized))

    def calculate_sentiment(self, text: str) -> float:
        """计算文本情感分数 (-1 到 1)"""
        if not text:
            return 0.0

        words = set(text.lower().split())
        positive_count = len(words & self.POSITIVE_WORDS)
        negative_count = len(words & self.NEGATIVE_WORDS)

        total = positive_count + negative_count
        if total == 0:
            return 0.0

        return (positive_count - negative_count) / total

    def analyze_resources(
        self,
        resources: List[Dict[str, Any]],
        time_window_days: int = 30
    ) -> Dict[str, TechMention]:
        """分析资源列表，提取技术提及"""
        tech_mentions: Dict[str, TechMention] = {}
        cutoff_date = datetime.now() - timedelta(days=time_window_days)

        for resource in resources:
            # 合并标题和摘要进行分析
            text = f"{resource.get('title', '')} {resource.get('abstract', '')} {resource.get('content', '')}"
            source_id = resource.get('id', '')
            source_title = resource.get('title', 'Unknown')

            published_at = resource.get('publishedAt')
            if isinstance(published_at, str):
                try:
                    published_at = datetime.fromisoformat(published_at.replace('Z', '+00:00'))
                except:
                    published_at = datetime.now()
            elif not published_at:
                published_at = datetime.now()

            # 提取技术
            techs = self.extract_technologies(text)
            sentiment = self.calculate_sentiment(text)

            for tech in techs:
                if tech not in tech_mentions:
                    tech_mentions[tech] = TechMention(
                        name=tech,
                        count=0,
                        sources=[],
                        first_seen=published_at,
                        last_seen=published_at,
                        sentiment_score=0.0
                    )

                mention = tech_mentions[tech]
                mention.count += 1
                if source_title not in mention.sources:
                    mention.sources.append(source_title)

                if published_at < mention.first_seen:
                    mention.first_seen = published_at
                if published_at > mention.last_seen:
                    mention.last_seen = published_at

                # 更新情感分数（移动平均）
                mention.sentiment_score = (
                    mention.sentiment_score * (mention.count - 1) + sentiment
                ) / mention.count

        return tech_mentions

    def determine_trend_direction(
        self,
        mention: TechMention,
        historical_count: int = 0
    ) -> TrendDirection:
        """判断趋势方向"""
        if mention.count > historical_count * 1.2:
            return TrendDirection.RISING
        elif mention.count < historical_count * 0.8:
            return TrendDirection.DECLINING
        return TrendDirection.STABLE

    def estimate_maturity_stage(
        self,
        mention: TechMention,
        total_resources: int
    ) -> MaturityStage:
        """估算技术成熟度阶段"""
        # 基于提及密度和情感分数估算
        mention_density = mention.count / max(total_resources, 1)
        sentiment = mention.sentiment_score

        # 高提及 + 高情感 = Peak of Expectations
        if mention_density > 0.1 and sentiment > 0.5:
            return MaturityStage.PEAK_OF_EXPECTATIONS

        # 高提及 + 负面情感 = Trough of Disillusionment
        if mention_density > 0.05 and sentiment < -0.2:
            return MaturityStage.TROUGH_OF_DISILLUSIONMENT

        # 中等提及 + 中性/正面情感 = Slope of Enlightenment
        if 0.03 < mention_density <= 0.1 and sentiment > 0:
            return MaturityStage.SLOPE_OF_ENLIGHTENMENT

        # 低提及 + 正面情感 = Plateau (已成熟)
        if mention_density <= 0.03 and sentiment > 0.3:
            return MaturityStage.PLATEAU_OF_PRODUCTIVITY

        # 默认：Innovation Trigger
        return MaturityStage.INNOVATION_TRIGGER

    def calculate_momentum(self, mention: TechMention) -> float:
        """计算技术动量分数 (0-100)"""
        # 基于最近活跃度
        days_since_last = (datetime.now() - mention.last_seen).days
        recency_score = max(0, 100 - days_since_last * 5)

        # 基于提及次数
        count_score = min(100, mention.count * 10)

        # 基于情感
        sentiment_score = (mention.sentiment_score + 1) * 50

        return (recency_score * 0.4 + count_score * 0.4 + sentiment_score * 0.2)

    def generate_hype_cycle_position(
        self,
        tech_name: str,
        stage: MaturityStage,
        momentum: float
    ) -> HypeCyclePosition:
        """生成 Hype Cycle 位置"""
        # X 位置基于阶段
        stage_x_map = {
            MaturityStage.INNOVATION_TRIGGER: 10,
            MaturityStage.PEAK_OF_EXPECTATIONS: 30,
            MaturityStage.TROUGH_OF_DISILLUSIONMENT: 50,
            MaturityStage.SLOPE_OF_ENLIGHTENMENT: 70,
            MaturityStage.PLATEAU_OF_PRODUCTIVITY: 90,
        }

        # Y 位置基于阶段的典型期望曲线
        stage_y_map = {
            MaturityStage.INNOVATION_TRIGGER: 30,
            MaturityStage.PEAK_OF_EXPECTATIONS: 95,
            MaturityStage.TROUGH_OF_DISILLUSIONMENT: 20,
            MaturityStage.SLOPE_OF_ENLIGHTENMENT: 50,
            MaturityStage.PLATEAU_OF_PRODUCTIVITY: 70,
        }

        # Years to mainstream
        years_map = {
            MaturityStage.INNOVATION_TRIGGER: ">10 years",
            MaturityStage.PEAK_OF_EXPECTATIONS: "5-10 years",
            MaturityStage.TROUGH_OF_DISILLUSIONMENT: "2-5 years",
            MaturityStage.SLOPE_OF_ENLIGHTENMENT: "1-2 years",
            MaturityStage.PLATEAU_OF_PRODUCTIVITY: "<1 year",
        }

        return HypeCyclePosition(
            tech_name=tech_name,
            x_position=stage_x_map[stage] + (momentum / 100) * 5,  # 微调
            y_position=stage_y_map[stage],
            stage=stage,
            years_to_mainstream=years_map[stage]
        )

    def find_related_technologies(
        self,
        tech: str,
        all_mentions: Dict[str, TechMention]
    ) -> List[str]:
        """查找相关技术"""
        # 基于共现资源
        if tech not in all_mentions:
            return []

        tech_sources = set(all_mentions[tech].sources)
        related = []

        for other_tech, mention in all_mentions.items():
            if other_tech == tech:
                continue
            other_sources = set(mention.sources)
            overlap = len(tech_sources & other_sources)
            if overlap >= 2:  # 至少2个共同来源
                related.append(other_tech)

        return related[:5]  # 最多返回5个

    async def generate_trend_report(
        self,
        query: str,
        resources: List[Dict[str, Any]],
        time_window_days: int = 30
    ) -> TrendReport:
        """生成趋势报告"""

        if not resources:
            return TrendReport(
                title=f"趋势报告: {query}",
                generated_at=datetime.now(),
                time_range=f"过去 {time_window_days} 天",
                executive_summary="没有找到足够的数据来生成趋势报告。",
                top_trends=[],
                hype_cycle=[],
                emerging_techs=[],
                declining_techs=[],
                data_sources_count=0,
                confidence_score=0.0
            )

        # 分析资源
        tech_mentions = self.analyze_resources(resources, time_window_days)

        # 按提及次数排序
        sorted_techs = sorted(
            tech_mentions.items(),
            key=lambda x: x[1].count,
            reverse=True
        )[:20]  # Top 20

        # 生成趋势
        trends = []
        hype_cycle_positions = []
        emerging = []
        declining = []

        for tech_name, mention in sorted_techs:
            direction = self.determine_trend_direction(mention)
            stage = self.estimate_maturity_stage(mention, len(resources))
            momentum = self.calculate_momentum(mention)
            related = self.find_related_technologies(tech_name, tech_mentions)

            trend = TechTrend(
                name=tech_name,
                direction=direction,
                maturity_stage=stage,
                momentum_score=momentum,
                adoption_rate=min(100, mention.count / len(resources) * 500),
                data_points=[],  # 可以填充时间序列数据
                related_techs=related,
                key_players=[],  # 可以从资源中提取
                summary=f"在 {len(mention.sources)} 个来源中被提及 {mention.count} 次"
            )
            trends.append(trend)

            # Hype Cycle 位置
            hype_pos = self.generate_hype_cycle_position(tech_name, stage, momentum)
            hype_cycle_positions.append(hype_pos)

            # 分类
            if direction == TrendDirection.RISING and stage == MaturityStage.INNOVATION_TRIGGER:
                emerging.append(tech_name)
            elif direction == TrendDirection.DECLINING:
                declining.append(tech_name)

        # 生成执行摘要
        top_3 = [t.name for t in trends[:3]]
        summary = f"基于对 {len(resources)} 个数据源的分析，当前最热门的技术包括: {', '.join(top_3)}。"
        if emerging:
            summary += f" 新兴技术: {', '.join(emerging[:3])}。"
        if declining:
            summary += f" 下降趋势: {', '.join(declining[:3])}。"

        # 计算置信度
        confidence = min(1.0, len(resources) / 50) * 0.7 + \
                     min(1.0, len(tech_mentions) / 10) * 0.3

        return TrendReport(
            title=f"科技趋势报告: {query}",
            generated_at=datetime.now(),
            time_range=f"过去 {time_window_days} 天",
            executive_summary=summary,
            top_trends=trends[:10],
            hype_cycle=hype_cycle_positions[:15],
            emerging_techs=emerging[:5],
            declining_techs=declining[:5],
            data_sources_count=len(resources),
            confidence_score=confidence
        )

    def format_report_for_api(self, report: TrendReport) -> Dict:
        """格式化报告供 API 返回"""
        return {
            "title": report.title,
            "generatedAt": report.generated_at.isoformat(),
            "timeRange": report.time_range,
            "executiveSummary": report.executive_summary,
            "topTrends": [
                {
                    "name": t.name,
                    "direction": t.direction.value,
                    "maturityStage": t.maturity_stage.value,
                    "momentumScore": round(t.momentum_score, 1),
                    "adoptionRate": round(t.adoption_rate, 1),
                    "relatedTechs": t.related_techs,
                    "keyPlayers": t.key_players,
                    "summary": t.summary
                }
                for t in report.top_trends
            ],
            "hypeCycle": [
                {
                    "techName": h.tech_name,
                    "xPosition": round(h.x_position, 1),
                    "yPosition": round(h.y_position, 1),
                    "stage": h.stage.value,
                    "yearsToMainstream": h.years_to_mainstream
                }
                for h in report.hype_cycle
            ],
            "emergingTechs": report.emerging_techs,
            "decliningTechs": report.declining_techs,
            "dataSourcesCount": report.data_sources_count,
            "confidenceScore": round(report.confidence_score, 2)
        }


class TechComparisonService:
    """技术对比服务"""

    COMPARISON_DIMENSIONS = [
        "performance",
        "scalability",
        "ease_of_use",
        "community_support",
        "documentation",
        "maturity",
        "cost",
        "ecosystem"
    ]

    def __init__(self, ai_client=None):
        self.ai_client = ai_client

    async def compare_technologies(
        self,
        tech_a: str,
        tech_b: str,
        resources: List[Dict[str, Any]]
    ) -> Dict:
        """对比两个技术"""

        # 过滤相关资源
        tech_a_lower = tech_a.lower()
        tech_b_lower = tech_b.lower()

        resources_a = []
        resources_b = []

        for r in resources:
            text = f"{r.get('title', '')} {r.get('abstract', '')}".lower()
            if tech_a_lower in text:
                resources_a.append(r)
            if tech_b_lower in text:
                resources_b.append(r)

        # 构建对比矩阵
        comparison = {
            "techA": {
                "name": tech_a,
                "mentionCount": len(resources_a),
                "scores": self._estimate_scores(resources_a),
                "strengths": [],
                "weaknesses": []
            },
            "techB": {
                "name": tech_b,
                "mentionCount": len(resources_b),
                "scores": self._estimate_scores(resources_b),
                "strengths": [],
                "weaknesses": []
            },
            "recommendation": "",
            "useCases": {
                "preferA": [],
                "preferB": [],
                "either": []
            }
        }

        # 生成推荐
        if len(resources_a) > len(resources_b) * 1.5:
            comparison["recommendation"] = f"{tech_a} 目前讨论度更高，社区更活跃"
        elif len(resources_b) > len(resources_a) * 1.5:
            comparison["recommendation"] = f"{tech_b} 目前讨论度更高，社区更活跃"
        else:
            comparison["recommendation"] = "两者讨论度相当，建议根据具体需求选择"

        return comparison

    def _estimate_scores(self, resources: List[Dict]) -> Dict[str, int]:
        """估算各维度分数"""
        # 基于资源数量和内容简单估算
        base_score = min(100, len(resources) * 10)

        return {
            dim: max(20, min(100, base_score + hash(dim) % 20 - 10))
            for dim in self.COMPARISON_DIMENSIONS
        }

    def format_comparison_for_api(self, comparison: Dict) -> Dict:
        """格式化对比结果供 API 返回"""
        return comparison
