import sys
with open("ai.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

# 在第一个@router.post之前插入OPTIONS处理器
new_lines = []
inserted = False
for i, line in enumerate(lines):
    if not inserted and "@router.post" in line and "/summary" in line:
        # 插入OPTIONS处理器
        new_lines.append('\n# OPTIONS endpoints for CORS preflight\n')
        new_lines.append('@router.options("/summary")\n')
        new_lines.append('@router.options("/insights")\n')
        new_lines.append('@router.options("/classify")\n')
        new_lines.append('@router.options("/simple-chat")\n')
        new_lines.append('@router.options("/quick-action")\n')
        new_lines.append('@router.options("/translate")\n')
        new_lines.append('@router.options("/translate-segments")\n')
        new_lines.append('@router.options("/youtube-report")\n')
        new_lines.append('@router.options("/chat")\n')
        new_lines.append('async def options_handler():\n')
        new_lines.append('    return {}\n')
        new_lines.append('\n')
        inserted = True
    new_lines.append(line)

with open("ai.py", "w", encoding="utf-8") as f:
    f.writelines(new_lines)

print("OPTIONS handlers added")
