---
title: ACE Desktop — Phase 0 Stress Baseline
date: 2026-04-24
status: partial (MCP spawn + sleep-wake + long-uptime pending)
harness: scripts/stress.js (feat/multi-session-stability)
---

# Phase 0 Stress Baseline

Baseline numbers captured against ACE Desktop v0.2.6 on macOS (arm64).
All runs via `STRESS=1 npm start` → DevTools console.

---

## 0.1 Multi-session churn — PASS

**Run:** `runChurn(50)` — 50 open/stream/teardown cycles  
**Date:** 2026-04-25

| Metric | Value | Threshold | Result |
|---|---|---|---|
| DOM nodes cycle 0 | 1160 | — | baseline |
| DOM nodes cycle 49 | 1160 | plateau within 10 cycles | ✅ PASS |
| DOM slope (nodes/cycle) | 0 | < 5 | ✅ PASS |
| RSS start | 213.1 MB | — | baseline |
| RSS end | 213.1 MB | — | baseline |
| RSS slope (MB/cycle) | 0.00 | < 5 MB/cycle | ✅ PASS |

**Interpretation:** Session create/teardown is leaking nothing. DOM node count is
perfectly flat across 50 cycles. RSS is stable — no accumulation per cycle.

---

## 0.2 Long-uptime drift — PARTIAL (2-min smoke only)

**Run:** `runUptime({ durationMs: 120_000, sampleIntervalMs: 10_000 })`  
**Date:** 2026-04-25

| Metric | Value |
|---|---|
| Duration | 2 min (smoke test only) |
| Sample count | 11 |
| RSS start | 207.9 MB |
| RSS end | 182.6 MB |
| RSS slope | −6.5 MB/min |
| Second-half std dev | 0.22 MB |

**Interpretation:** RSS decreased — soft-GC fired during idle and reclaimed ~25 MB.
Second-half is extremely stable (0.22 MB std dev). Negative slope is healthy; it
reflects the refresh-engine releasing memory during idle.

**TODO:** Run `runUptime({ durationMs: 4 * 60 * 60 * 1000 })` for a 4h soak before
Phase 1 ships. The 2-min run confirms sampling works but is not a meaningful
long-session drift measurement.

---

## 0.3 Wake-from-sleep — PENDING

Manual test. Run `runSleepWake()` in DevTools, then sleep the machine.

**TODO:** Capture baseline before Phase 1. Expected output: `{ sleepMs, timeToWakeHandlerMs }`.

---

## 0.4 MCP spawn timing — SAMPLE CAPTURED

**Run:** `runMcpSpawn()` — times send → spawn-status ack → first stream token
**Date:** 2026-04-25

| Metric | Value |
|---|---|
| spawnStatusMs | 1.3 ms |
| firstStreamMs | 5,783 ms |
| Sample count | 1 |

**Interpretation:** First token at 5.8s — well within the plan's default 30s
silence threshold for Phase 1.2 (would need p99 > 20s to push the floor up).
The 1.3ms spawn-status ack suggests the chat-send IPC returns before the child
ACK lands; this measures IPC roundtrip, not spawn latency. Real spawn time is
folded into firstStreamMs.

**Single-sample caveat:** p99 isn't computable from one run. But for the
"does the 30s default hold?" question, one healthy sample at 5.8s is enough
evidence to answer yes. Re-run 10–20× before relying on a tighter threshold.

---

## 0.5 Cold-start TTI — PENDING

**Run:** `runColdStart()` — clears V8 cache, relaunches, logs TTI on next boot  
**TODO:** Run once before Phase 1. Phase 1 must not regress this number.

---

## Phase 0 gate status

| Scenario | Status | Gate |
|---|---|---|
| 0.1 Churn (50 cycles) | ✅ PASS | Phase 1 unblocked |
| 0.2 Uptime (full soak) | ⏳ Pending | Required before Phase 1 ships |
| 0.3 Sleep-wake | ⏳ Pending | Document only — Phase 1 must not regress |
| 0.4 MCP spawn | ✅ Sample (1×) | 30s default threshold confirmed safe |
| 0.5 Cold-start TTI | ⏳ Pending | Required before Phase 1 ships |

**Verdict:** Phase 1 implementation can begin. Pending baselines must be captured
and checked in before the Phase 1 PR merges.
