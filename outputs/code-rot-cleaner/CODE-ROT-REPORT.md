# Code Rot Report

> **REPORT READY** — The real project was not changed.

Project: `/Users/lassevestergaard/Documents/dev/loora`  
Generated: `2026-07-21T14:32:09Z`

## Executive summary

| Result | Candidates | LOC | Size |
|---|---:|---:|---:|
| SAFE TO REMOVE | 0 | 0 | 0 B |
| REVIEW | 47 | 4,140 | 132.6 KB |
| KEEP | 0 | 0 | 0 B |

## Review highlights

- The strongest file-level lead is an unreachable web UI set: 33 files, 4,138 LOC, and 132.5 KB. It includes an isolated `ai-elements/tool.tsx` → `code-block.tsx` subtree and 31 unused UI primitives.
- Thirteen `apps/web` dependency entries have no live checked-in consumer. `react-day-picker` and `shiki` become removable only with their unreachable component parents; several auth/Polar entries appear duplicated from `@loora/auth`.
- Root scripts `docs:dev` and `docs:build` target a missing `apps/docs` workspace. They remain REVIEW because checkpoint history suggests the docs app may be intended for a later merge or restoration.
- The raw scanner's 472 unused-export leads were too noisy to treat as actionable. Alias-aware review also rejected 66 apparent orphan files that are routes, configs, package surfaces, or imported through Loora's `#/` and workspace aliases.
- No test, typecheck, build, route generation, install, or application command was executed. Static evidence alone cannot produce SAFE TO REMOVE.

## Ranked candidates

| ID | Status | Category | Subject | Confidence | Risk | LOC | Proof |
|---|---|---|---|---|---|---:|---|
| CRT-006 | **REVIEW** | orphan-file | `apps/web/src/components/ai-elements/tool.tsx` | high | low | 167 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-020 | **REVIEW** | orphan-file | `apps/web/src/components/ui/accordion.tsx` | high | low | 68 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-022 | **REVIEW** | orphan-file | `apps/web/src/components/ui/alert.tsx` | high | low | 84 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-024 | **REVIEW** | orphan-file | `apps/web/src/components/ui/avatar.tsx` | high | low | 52 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-026 | **REVIEW** | orphan-file | `apps/web/src/components/ui/breadcrumb.tsx` | high | low | 110 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-029 | **REVIEW** | orphan-file | `apps/web/src/components/ui/calendar.tsx` | high | low | 135 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-030 | **REVIEW** | orphan-file | `apps/web/src/components/ui/card.tsx` | high | low | 253 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-031 | **REVIEW** | orphan-file | `apps/web/src/components/ui/checkbox-group.tsx` | high | low | 19 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-032 | **REVIEW** | orphan-file | `apps/web/src/components/ui/checkbox.tsx` | high | low | 68 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-034 | **REVIEW** | orphan-file | `apps/web/src/components/ui/combobox.tsx` | high | low | 435 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-040 | **REVIEW** | orphan-file | `apps/web/src/components/ui/empty.tsx` | high | low | 134 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-041 | **REVIEW** | orphan-file | `apps/web/src/components/ui/field.tsx` | high | low | 80 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-042 | **REVIEW** | orphan-file | `apps/web/src/components/ui/fieldset.tsx` | high | low | 32 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-043 | **REVIEW** | orphan-file | `apps/web/src/components/ui/form.tsx` | high | low | 13 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-044 | **REVIEW** | orphan-file | `apps/web/src/components/ui/frame.tsx` | high | low | 87 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-045 | **REVIEW** | orphan-file | `apps/web/src/components/ui/group.tsx` | high | low | 92 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-049 | **REVIEW** | orphan-file | `apps/web/src/components/ui/kbd.tsx` | high | low | 31 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-051 | **REVIEW** | orphan-file | `apps/web/src/components/ui/menu.tsx` | high | low | 352 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-052 | **REVIEW** | orphan-file | `apps/web/src/components/ui/meter.tsx` | high | low | 80 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-053 | **REVIEW** | orphan-file | `apps/web/src/components/ui/number-field.tsx` | high | low | 158 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-054 | **REVIEW** | orphan-file | `apps/web/src/components/ui/otp-field.tsx` | high | low | 65 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-055 | **REVIEW** | orphan-file | `apps/web/src/components/ui/pagination.tsx` | high | low | 127 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-057 | **REVIEW** | orphan-file | `apps/web/src/components/ui/preview-card.tsx` | high | low | 61 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-059 | **REVIEW** | orphan-file | `apps/web/src/components/ui/radio-group.tsx` | high | low | 42 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-068 | **REVIEW** | orphan-file | `apps/web/src/components/ui/switch.tsx` | high | low | 30 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-069 | **REVIEW** | orphan-file | `apps/web/src/components/ui/table.tsx` | high | low | 151 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-072 | **REVIEW** | orphan-file | `apps/web/src/components/ui/toast.tsx` | high | low | 320 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-073 | **REVIEW** | orphan-file | `apps/web/src/components/ui/toggle-group.tsx` | high | low | 103 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-075 | **REVIEW** | orphan-file | `apps/web/src/components/ui/toolbar.tsx` | high | low | 91 | Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run. |
| CRT-568 | **REVIEW** | orphan-file | `apps/web/src/components/ai-elements/code-block.tsx` | high | low | 562 | Transitively unreachable, but it must be proved in a multi-file batch with its unreachable parent. |
| CRT-569 | **REVIEW** | orphan-file | `apps/web/src/components/ui/badge.tsx` | high | low | 64 | Transitively unreachable, but it must be proved in a multi-file batch with its unreachable parent. |
| CRT-570 | **REVIEW** | orphan-file | `apps/web/src/components/ui/label.tsx` | high | low | 26 | Transitively unreachable, but it must be proved in a multi-file batch with its unreachable parent. |
| CRT-571 | **REVIEW** | orphan-file | `apps/web/src/components/ui/toggle.tsx` | high | low | 46 | Transitively unreachable, but it must be proved in a multi-file batch with its unreachable parent. |
| CRT-572 | **REVIEW** | stale-script | `docs:dev and docs:build scripts in package.json` | high | medium | 2 | The target workspace is absent, but the scripts may anticipate a pending docs merge or restoration. |
| CRT-573 | **REVIEW** | unused-dependency | `@opencoredev/loginwithchatgpt-server (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-574 | **REVIEW** | unused-dependency | `@polar-sh/better-auth (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-575 | **REVIEW** | unused-dependency | `@polar-sh/sdk (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-576 | **REVIEW** | unused-dependency | `@tanstack/react-router-ssr-query (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-577 | **REVIEW** | unused-dependency | `@tanstack/router-plugin (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-578 | **REVIEW** | unused-dependency | `@twind/core (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-579 | **REVIEW** | unused-dependency | `@twind/preset-autoprefix (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-580 | **REVIEW** | unused-dependency | `@twind/preset-tailwind (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-581 | **REVIEW** | unused-dependency | `better-auth (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-582 | **REVIEW** | unused-dependency | `cmdk (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-583 | **REVIEW** | unused-dependency | `playwright-core (apps/web devDependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-584 | **REVIEW** | unused-dependency | `react-day-picker (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |
| CRT-585 | **REVIEW** | unused-dependency | `shiki (apps/web dependency)` | high | medium | 0 | No checked-in usage found, but manifest and lockfile removal has not been proved. |

## Evidence by candidate

### CRT-006 — REVIEW

- Location: `apps/web/src/components/ai-elements/tool.tsx`
- Category: `orphan-file`
- Potential size: 167 LOC / 5.0 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: tool. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-020 — REVIEW

- Location: `apps/web/src/components/ui/accordion.tsx`
- Category: `orphan-file`
- Potential size: 68 LOC / 2.1 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-022 — REVIEW

- Location: `apps/web/src/components/ui/alert.tsx`
- Category: `orphan-file`
- Potential size: 84 LOC / 2.4 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: alert. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-024 — REVIEW

- Location: `apps/web/src/components/ui/avatar.tsx`
- Category: `orphan-file`
- Potential size: 52 LOC / 1.2 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: avatar. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-026 — REVIEW

- Location: `apps/web/src/components/ui/breadcrumb.tsx`
- Category: `orphan-file`
- Potential size: 110 LOC / 2.5 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-029 — REVIEW

- Location: `apps/web/src/components/ui/calendar.tsx`
- Category: `orphan-file`
- Potential size: 135 LOC / 5.2 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: calendar. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-030 — REVIEW

- Location: `apps/web/src/components/ui/card.tsx`
- Category: `orphan-file`
- Potential size: 253 LOC / 6.9 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: card, card.tsx. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-031 — REVIEW

- Location: `apps/web/src/components/ui/checkbox-group.tsx`
- Category: `orphan-file`
- Potential size: 19 LOC / 458 B
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-032 — REVIEW

- Location: `apps/web/src/components/ui/checkbox.tsx`
- Category: `orphan-file`
- Potential size: 68 LOC / 2.9 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: checkbox. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-034 — REVIEW

- Location: `apps/web/src/components/ui/combobox.tsx`
- Category: `orphan-file`
- Potential size: 435 LOC / 14.7 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: combobox. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-040 — REVIEW

- Location: `apps/web/src/components/ui/empty.tsx`
- Category: `orphan-file`
- Potential size: 134 LOC / 3.4 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: empty. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-041 — REVIEW

- Location: `apps/web/src/components/ui/field.tsx`
- Category: `orphan-file`
- Potential size: 80 LOC / 1.8 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: field. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-042 — REVIEW

- Location: `apps/web/src/components/ui/fieldset.tsx`
- Category: `orphan-file`
- Potential size: 32 LOC / 705 B
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-043 — REVIEW

- Location: `apps/web/src/components/ui/form.tsx`
- Category: `orphan-file`
- Potential size: 13 LOC / 309 B
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: form. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-044 — REVIEW

- Location: `apps/web/src/components/ui/frame.tsx`
- Category: `orphan-file`
- Potential size: 87 LOC / 1.9 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: frame, frame.tsx. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-045 — REVIEW

- Location: `apps/web/src/components/ui/group.tsx`
- Category: `orphan-file`
- Potential size: 92 LOC / 4.8 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: group, group.tsx. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-049 — REVIEW

- Location: `apps/web/src/components/ui/kbd.tsx`
- Category: `orphan-file`
- Potential size: 31 LOC / 769 B
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-051 — REVIEW

- Location: `apps/web/src/components/ui/menu.tsx`
- Category: `orphan-file`
- Potential size: 352 LOC / 12.1 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: menu, menu.tsx. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-052 — REVIEW

- Location: `apps/web/src/components/ui/meter.tsx`
- Category: `orphan-file`
- Potential size: 80 LOC / 1.7 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: meter. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-053 — REVIEW

- Location: `apps/web/src/components/ui/number-field.tsx`
- Category: `orphan-file`
- Potential size: 158 LOC / 5.7 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: number-field. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-054 — REVIEW

- Location: `apps/web/src/components/ui/otp-field.tsx`
- Category: `orphan-file`
- Potential size: 65 LOC / 2.7 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-055 — REVIEW

- Location: `apps/web/src/components/ui/pagination.tsx`
- Category: `orphan-file`
- Potential size: 127 LOC / 3.1 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: pagination. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-057 — REVIEW

- Location: `apps/web/src/components/ui/preview-card.tsx`
- Category: `orphan-file`
- Potential size: 61 LOC / 2.1 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-059 — REVIEW

- Location: `apps/web/src/components/ui/radio-group.tsx`
- Category: `orphan-file`
- Potential size: 42 LOC / 2.0 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: radio-group. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-068 — REVIEW

- Location: `apps/web/src/components/ui/switch.tsx`
- Category: `orphan-file`
- Potential size: 30 LOC / 1.6 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: switch. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-069 — REVIEW

- Location: `apps/web/src/components/ui/table.tsx`
- Category: `orphan-file`
- Potential size: 151 LOC / 5.3 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: table. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-072 — REVIEW

- Location: `apps/web/src/components/ui/toast.tsx`
- Category: `orphan-file`
- Potential size: 320 LOC / 14.7 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: toast. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-073 — REVIEW

- Location: `apps/web/src/components/ui/toggle-group.tsx`
- Category: `orphan-file`
- Potential size: 103 LOC / 3.5 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-075 — REVIEW

- Location: `apps/web/src/components/ui/toolbar.tsx`
- Category: `orphan-file`
- Potential size: 91 LOC / 2.1 KB
- Status reason: Strong alias-aware static evidence, but no approved disposable-copy test/build/typecheck proof has run.
- Evidence: No resolved static inbound import was found. The file is not a detected package or conventional entry point. Repository text contains possible string/name references: toolbar. Alias-aware import resolution and entry-point reachability found no inbound path from the current app, routes, tests, scripts, or package exports.
- Caveats: Dynamic loading, reflection, external consumers, or incomplete framework detection can hide reachability. Possible string reachability prevents high-confidence deletion. Static evidence still requires disposable-copy proof before removal can be classified safe.

### CRT-568 — REVIEW

- Location: `apps/web/src/components/ai-elements/code-block.tsx`
- Category: `orphan-file`
- Potential size: 562 LOC / 13.5 KB
- Status reason: Transitively unreachable, but it must be proved in a multi-file batch with its unreachable parent.
- Evidence: Its only inbound import is from apps/web/src/components/ai-elements/tool.tsx. That parent module is unreachable from the web app entry points, routes, and tests.
- Caveats: This transitive file must be proved as part of the isolated ai-elements batch, not by deleting it alone.

### CRT-569 — REVIEW

- Location: `apps/web/src/components/ui/badge.tsx`
- Category: `orphan-file`
- Potential size: 64 LOC / 2.7 KB
- Status reason: Transitively unreachable, but it must be proved in a multi-file batch with its unreachable parent.
- Evidence: Its only inbound import is from the unreachable apps/web/src/components/ai-elements/tool.tsx module.
- Caveats: This transitive file must be proved with its unreachable parent.

### CRT-570 — REVIEW

- Location: `apps/web/src/components/ui/label.tsx`
- Category: `orphan-file`
- Potential size: 26 LOC / 633 B
- Status reason: Transitively unreachable, but it must be proved in a multi-file batch with its unreachable parent.
- Evidence: Its only inbound import is from the unreachable apps/web/src/components/ui/number-field.tsx module.
- Caveats: This transitive file must be proved with its unreachable parent.

### CRT-571 — REVIEW

- Location: `apps/web/src/components/ui/toggle.tsx`
- Category: `orphan-file`
- Potential size: 46 LOC / 2.3 KB
- Status reason: Transitively unreachable, but it must be proved in a multi-file batch with its unreachable parent.
- Evidence: Its only inbound import is from the unreachable apps/web/src/components/ui/toggle-group.tsx module.
- Caveats: This transitive file must be proved with its unreachable parent.

### CRT-572 — REVIEW

- Location: `package.json:20`
- Category: `stale-script`
- Potential size: 2 LOC / 104 B
- Status reason: The target workspace is absent, but the scripts may anticipate a pending docs merge or restoration.
- Evidence: Both scripts target apps/docs, but no apps/docs workspace exists in the current tree. The docs app exists only on non-ancestor checkpoint refs, not on HEAD.
- Caveats: The scripts may be intentional preparation for restoring or merging the docs workspace.

### CRT-573 — REVIEW

- Location: `apps/web/package.json:27`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No apps/web source, config, CSS, or script reference was found. Server usage lives in @loora/auth, which declares its own dependency.
- Caveats: Manifest and lockfile changes require focused proof and explicit approval.

### CRT-574 — REVIEW

- Location: `apps/web/package.json:31`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No apps/web source, config, CSS, or script reference was found. Polar integration usage lives in @loora/auth, which declares its own dependency.
- Caveats: Manifest and lockfile changes require focused proof and explicit approval.

### CRT-575 — REVIEW

- Location: `apps/web/package.json:32`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No apps/web source, config, CSS, or script reference was found. Polar SDK usage lives in @loora/auth, which declares its own dependency.
- Caveats: Manifest and lockfile changes require focused proof and explicit approval.

### CRT-576 — REVIEW

- Location: `apps/web/package.json:41`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No source, route, Vite config, CSS, or package script reference was found.
- Caveats: Framework integrations can be loaded indirectly; a production build is required for proof.

### CRT-577 — REVIEW

- Location: `apps/web/package.json:43`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: apps/web/vite.config.ts uses @tanstack/react-start/plugin/vite, not @tanstack/router-plugin. No other source, config, CSS, or package script reference was found.
- Caveats: Framework tooling can rely on peer packages; route generation and a build are required for proof.

### CRT-578 — REVIEW

- Location: `apps/web/package.json:44`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No source, config, CSS, or script reference was found; the app uses Tailwind CSS and vendored browser assets.
- Caveats: Manifest and lockfile changes require focused proof and explicit approval.

### CRT-579 — REVIEW

- Location: `apps/web/package.json:45`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No source, config, CSS, or script reference was found.
- Caveats: Manifest and lockfile changes require focused proof and explicit approval.

### CRT-580 — REVIEW

- Location: `apps/web/package.json:46`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No source, config, CSS, or script reference was found.
- Caveats: Manifest and lockfile changes require focused proof and explicit approval.

### CRT-581 — REVIEW

- Location: `apps/web/package.json:48`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No apps/web source, config, CSS, or script reference was found. Better Auth usage lives in @loora/auth, which declares its own dependency.
- Caveats: Manifest and lockfile changes require focused proof and explicit approval.

### CRT-582 — REVIEW

- Location: `apps/web/package.json:51`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No source, config, CSS, or script reference was found; command UI uses @base-ui/react autocomplete components.
- Caveats: Manifest and lockfile changes require focused proof and explicit approval.

### CRT-583 — REVIEW

- Location: `apps/web/package.json:82`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: No source, test, config, or package script reference was found.
- Caveats: It may be retained for ad hoc browser tooling outside checked-in scripts. Manifest and lockfile changes require focused proof and explicit approval.

### CRT-584 — REVIEW

- Location: `apps/web/package.json:61`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: Its only import is from the unreachable apps/web/src/components/ui/calendar.tsx module.
- Caveats: Prove removal together with the calendar component and lockfile update.

### CRT-585 — REVIEW

- Location: `apps/web/package.json:63`
- Category: `unused-dependency`
- Potential size: 0 LOC / 0 B
- Status reason: No checked-in usage found, but manifest and lockfile removal has not been proved.
- Evidence: Its only import is from the unreachable apps/web/src/components/ai-elements/code-block.tsx module.
- Caveats: Prove removal together with the isolated ai-elements subtree and lockfile update.

## Cleanup approval checklist

No cleanup has been applied. To continue, select exact candidate IDs and review their paths, evidence, proof, and residual risk. Manifest or lockfile changes require separate explicit approval.

```text
Approved candidate IDs: ____________________
Approved files / manifest entries: __________
Approved verification commands: _____________
```

## Scope and limitations

- Scanned 219 source files, 34,457 LOC, 1.1 MB.
- Static analysis cannot prove absence of dynamic, reflective, operational, platform-specific, or external use.
- JavaScript/TypeScript and Python import resolution is intentionally conservative and does not implement every alias or framework convention.
- Unused dependencies and exports are leads only until project-native tooling and focused proof support removal.
- No project code, package command, or dependency was executed by this scanner.
- The bundled raw scan is preserved as raw-analysis.json; its 472 symbol-only unused-export leads and 66 rejected orphan leads were excluded from the ranked report because alias-aware review could not support file removal.
- The scanner ran against a disposable git-tracked snapshot of HEAD so 978 ignored generated source files under apps/web/.output could not pollute results.
- The curated dependency leads were checked across workspace source, configs, CSS, and scripts, but no manifest or lockfile was changed or installed tooling executed.
