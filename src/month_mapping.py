"""Nominal month assignment per contest type.

The OIerDb dataset only carries `year` and `fall_semester` on contests, no full
date. For a monthly bar-chart-race animation we assign each contest type a
fixed nominal month based on its typical real-world schedule. This is an
approximation — actual dates drift between years (e.g. IOI 2020 was held in
September due to COVID) — but it's good enough for the animation's storytelling
purpose.
"""

CONTEST_MONTH = {
    "NOI":       7,   # 七月下旬
    "IOI":       8,   # 八月（国际信息学奥林匹克）
    "APIO":      5,   # 五月（亚太地区赛）
    "CTSC":      5,   # 五月（已停办）
    "WC":        1,   # 一月（冬令营）
    "NOIP":     11,   # 旧 NOIP（2018 前）
    "NOIP提高": 11,
    "NOIP普及": 11,
    "CSP提高":  10,   # 十月
    "CSP入门":  10,
    "NOID类":    7,   # 与 NOI 同期
    "NGOI":      5,   # 全国青少年女子赛
    "NOIST":     7,   # NOI 选拔
}


def nominal_month(contest_type: str) -> int:
    """Return the nominal month (1-12) for a contest type."""
    if contest_type not in CONTEST_MONTH:
        raise KeyError(
            f"未知赛事类型 {contest_type!r}，请在 month_mapping.py 中补充"
        )
    return CONTEST_MONTH[contest_type]
