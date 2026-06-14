/**
 * 高置信 PII 脱敏（E46，2026-05-25）—— 仅脱敏「过 Luhn 校验的信用卡号」。
 *
 * 为什么只做信用卡号：研究/报告平台里 email、长数字 ID、数据序列都是合法正文，
 * 全量 PII 正则（email/手机/身份证/裸 16 位）会大面积误伤引文与数据。信用卡号
 * 13-19 位 + Luhn 校验后误报率极低，是唯一适合在报告输出侧无条件脱敏的 PII。
 *
 * 长度保持（关键）：用 '*' 替换每个数字、保留分隔符，使文本长度不变 ——
 * ReportArtifact 的 sections 用 startOffset/endOffset 索引 fullMarkdown，
 * citation occurrence 也按字符偏移定位；脱敏一旦改变长度，所有 section / 角标
 * 偏移全部错位。故必须等长替换。
 */
export function redactCreditCards(text: string): {
  text: string;
  redactedCount: number;
} {
  if (!text) return { text, redactedCount: 0 };
  let redactedCount = 0;
  // 候选：13-19 位数字，允许单个 空格/连字符 作分隔（覆盖 4111-1111-1111-1111 / 连写）
  const candidate = /\d(?:[ -]?\d){12,18}/g;
  const out = text.replace(candidate, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhnValid(digits)) return match;
    redactedCount++;
    // 等长替换：数字 → '*'，分隔符原样保留 → 偏移不变
    return match.replace(/\d/g, "*");
  });
  return { text: out, redactedCount };
}

/** 标准 Luhn 校验（信用卡号尾位校验和）。 */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // '0' = 48
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}
