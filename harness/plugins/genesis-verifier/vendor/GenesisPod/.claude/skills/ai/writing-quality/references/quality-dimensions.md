# Quality Dimensions

## 1. Expression Diversity

| Check         | Problem                        | Solution             |
| ------------- | ------------------------------ | -------------------- |
| Vocab repeat  | "心中一震" appears too often   | Expression cooling   |
| Sentence mono | Similar sentence lengths       | Force diversity      |
| Opening same  | Every chapter starts similarly | Opening type cooling |

**Detection:**

```bash
grep -c "心中一震\|心头一紧\|微微一笑" novel.md
```

## 2. Narrative Pacing

| Check         | Problem                   | Solution                |
| ------------- | ------------------------- | ----------------------- |
| Passive hero  | Protagonist only observes | Force action constraint |
| Plot stagnant | No substantial progress   | Required progress point |
| Rhythm mono   | All conflict or all setup | Balance constraint      |

**Detection keywords:**

- Active: 决定、选择、采取、反击、计划
- Passive: 只能看着、默默注视、无能为力

## 3. Character Consistency

| Check       | Problem                         | Solution                |
| ----------- | ------------------------------- | ----------------------- |
| Voice same  | All characters speak alike      | Character personality   |
| Trait drift | Actions don't match settings    | Character profile check |
| Title wrong | Self-reference/honorifics wrong | Identity language rules |

## 4. Style Match

| Style  | Core Features             | Common Issues       |
| ------ | ------------------------- | ------------------- |
| 甄嬛传 | Double meanings, subtlety | Dialogue too direct |
| 金庸   | Grand, chivalrous spirit  | Lacks wuxia feel    |
| 古龙   | Short, crisp, mysterious  | Sentences too long  |

## Diagnosis Flow

### Issue 1: Repetitive Chapter Openings

**Symptom:** Multiple chapters start with same pattern (e.g., "站在庭院中")

**Steps:**

1. Extract first 100 chars of each chapter
2. Compare opening patterns
3. Check expression cooling effectiveness

**Solution:**

- Expand `CHAPTER_OPENING` detection patterns
- Increase cooling chapters (recommend 25)
- Add explicit diversity requirement in prompt

### Issue 2: Passive Protagonist

**Symptom:** Protagonist only observes for multiple chapters

**Steps:**

1. Count "active action" per chapter
2. Detect passive keyword density
3. Evaluate consecutive passive chapters

**Solution:**

- Use `NarrativePacingService` action constraint
- Pre-set protagonist decision points in outline
- Limit consecutive passive chapters (≤2)
