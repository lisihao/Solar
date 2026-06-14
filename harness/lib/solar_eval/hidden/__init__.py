"""Hidden sub-package — holdout management and anti-reward-hacking detection."""
from __future__ import annotations

from .holdout_manager import HoldoutManager, HoldoutSplit, HoldoutEntry
from .anti_reward_hacking import AntiRewardHackingDetector, HackingAlert

__all__ = [
    "HoldoutManager",
    "HoldoutSplit",
    "HoldoutEntry",
    "AntiRewardHackingDetector",
    "HackingAlert",
]
