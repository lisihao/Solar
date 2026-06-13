# Third-party module type stubs

This directory holds hand-written `.d.ts` files for npm packages whose own
types are missing or incomplete for the way we use them. Add a stub here
ONLY if all of the following hold:

1. The package does not ship its own types AND there is no `@types/<pkg>`
   on npm, OR
2. The package's official types do exist but are missing fields/methods
   that our code legitimately uses, AND
3. We do not own the package and cannot upstream the missing API.

If neither (1) nor (2) holds, the right answer is to delete the stub —
official types are stricter and stay in sync with the runtime, so they
catch real bugs that hand-written stubs hide.

## Current stubs

| File                | Why we need it                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tesseract.js.d.ts` | The `tesseract.js` package ships its own types, but they do not expose `tessedit_pageseg_mode`, `Page.lines[]`, `Page.words[]`, or `Page.imageSize`. Our `ocr-recognition.tool.ts` uses all four. Removing the stub → 7+ TS errors in that file.                                                         |
| `youtubei.d.ts`     | The `youtubei.js` package ships its own types but the transcript path returns `TranscriptSegment \| TranscriptSectionHeader` while we treat the segments as a single shape. Our `youtube.service.ts` would fail type-checking without the loose-typed override. There is no `@types/youtubei.js` on npm. |

## Removed in PR-X29 / PR-X39

| File            | Why we deleted it                                                                                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai.d.ts`   | The official `openai` npm package ships full, current types. Our hand-written stub was masking newer SDK APIs (tool calling, structured output, response_format) from the compiler.                                                                                                                            |
| `turndown.d.ts` | We load `turndown` via `await import("turndown")` (dynamic import). In dev `tsc --noEmit` skips the resolution, but `nest build` in Docker resolves it strictly and errors `TS7016: Could not find a declaration file`. PR-X42 followup: installed `@types/turndown@^5.0.6` instead — the official-types path. |
