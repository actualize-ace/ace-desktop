# Renderer Stress Harness

Dev-only harness for measuring chat + pty rendering scalability in ACE Desktop.
Gives reproducible frame-time numbers so perf patches can be evaluated against
a baseline rather than vibes.

## Running

```bash
cd ace-desktop
STRESS=1 npm start
```

This sets a dev-only env var. `main.js` detects it (only when
`!app.isPackaged`) and appends `?stress=1` to the renderer URL. The renderer
dynamically imports `scripts/stress.js` and exposes its public API on
`window.__stress`.

Then in DevTools Console:

```js
// 6 chat sessions, 3 streaming — default 60s window
await __stress.runChatHeavy(6, 20, 3)

// 6 terminal sessions pumping `yes "xxxxxxxx"` through real ptys
await __stress.runPtyHeavy(6)
```

Each run:

- starts a `requestAnimationFrame`-based frame-gap recorder
- runs the scenario for `opts.durationMs` (default 60000)
- stops, prints a JSON result summary to the console
- appends one JSON line to `scripts/stress-results.jsonl` via dev-only IPC

## API

```ts
runChatHeavy(
  n: number = 6,
  msgsPerSession: number = 20,
  streamingCount: number = 3,
  opts?: {
    durationMs?: number       // default 60000
    deltaIntervalMs?: number  // default 20 (ms between synthetic chunks)
    fixturePath?: string      // override default fixture
    label?: string            // label for results entry
  }
): Promise<Result>

runPtyHeavy(
  n: number = 6,
  opts?: {
    durationMs?: number
    cmd?: string  // default: 'yes "xxxxxxxx"\r'
    cwd?: string  // default: /tmp
    label?: string
  }
): Promise<Result>
```

Result shape:

```json
{
  "scenario": "chat-heavy",
  "ts": "2026-04-16T…Z",
  "n": 6,
  "streamingCount": 3,
  "frames": 3560,
  "p50": 16.7,
  "p95": 42.1,
  "p99": 118.5,
  "max": 284.3,
  "over16": 1204,
  "over50": 88,
  "over100": 14,
  "peakHeapMB": 241.8
}
```

## Pass criterion (per plan)

After Tasks 0–5:

- Chat-heavy (6 sess, 3 streaming): P99 < 50ms, zero frames > 100ms / 60s.
- Pty-heavy (6 sess): P99 < 50ms.
- Combined: P99 < 75ms, zero frames > 150ms.

## Fixture

`scripts/fixtures/stream-response-20k.jsonl` — synthetic, deterministic.
Each line is a `content_block_delta` stream event matching the shape emitted
by the real Claude CLI stream-json output. Contains ~2400 events / ~290KB of
markdown with mixed paragraphs, code fences, lists, headings, and wikilinks.

To replace with a real capture from Claude CLI:

```bash
claude -p "write a long technical essay on renderer scalability" \
  --output-format stream-json \
  > scripts/fixtures/stream-response-20k.jsonl
```

Whatever you drop in, the harness cycles through it to sustain streaming
load for the full `durationMs`.

## Results file

`scripts/stress-results.jsonl` is an append-only log. Each run adds one line.
Compare runs by label:

```bash
jq -c 'select(.scenario=="chat-heavy")' scripts/stress-results.jsonl
```

## Implementation notes

- Harness creates minimal DOM per test session (bypassing `SESSION_LIMIT` and
  full `spawnSession` chrome). This keeps production code untouched at Task 0.
- Panes are `display:none` during runs so the measurement reflects render
  work, not layout paint. If you want visual verification, remove the
  `pane.style.display = 'none'` line in `_createHarnessChatSession`.
- `performance.memory` is Chromium-only; `peakHeapMB` will read 0 in
  non-Chromium contexts (not relevant for Electron).
