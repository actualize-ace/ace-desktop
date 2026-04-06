<script>
  import { getDashboard } from '@stores/dashboard.svelte.js'

  const dashboard = getDashboard()

  const scoreMap = { green: 2, yellow: 1, red: 0, dim: 0 }

  let triad = $derived.by(() => {
    const vs = dashboard.vaultState
    // Prefer explicit triad fields if present (0-100)
    if (vs?.triadAuthority != null && vs?.triadCapacity != null && vs?.triadExpansion != null) {
      return {
        authority: Math.round(vs.triadAuthority),
        capacity: Math.round(vs.triadCapacity),
        expansion: Math.round(vs.triadExpansion),
      }
    }
    // Fallback: compute from metrics._signals (9 signals, 3 per leg, max 6 per leg)
    const signals = dashboard.metrics?._signals || Array(9).fill('dim')
    const legScore = (start) => {
      const raw = (scoreMap[signals[start]] || 0) + (scoreMap[signals[start + 1]] || 0) + (scoreMap[signals[start + 2]] || 0)
      return Math.round((raw / 6) * 100)
    }
    return {
      authority: legScore(0),
      capacity: legScore(3),
      expansion: legScore(6),
    }
  })

  const legs = $derived([
    { key: 'authority', label: 'Authority', color: 'var(--authority)', value: triad.authority },
    { key: 'capacity', label: 'Capacity', color: 'var(--capacity)', value: triad.capacity },
    { key: 'expansion', label: 'Expansion', color: 'var(--expansion)', value: triad.expansion },
  ])

  let now = $state(new Date())

  $effect(() => {
    const id = setInterval(() => { now = new Date() }, 1000)
    return () => clearInterval(id)
  })

  let timeStr = $derived(
    now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  )
</script>

<div class="triad-bar">
  {#each legs as leg, i (leg.key)}
    {#if i > 0}
      <div class="t-sep"></div>
    {/if}
    <div class="tm">
      <div class="tm-lbl" style:color={leg.color}>{leg.label}</div>
      <div class="tm-track">
        <div class="tm-fill" style:background={leg.color} style:width="{leg.value}%"></div>
      </div>
      <div class="tm-val">{leg.value > 0 ? leg.value : '\u2014'}</div>
    </div>
  {/each}
  <div class="live-time">{timeStr}</div>
</div>

<style>
  .triad-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 28px;
    display: flex;
    align-items: center;
    padding: 0 18px;
    gap: 24px;
    background: rgba(10, 12, 22, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--border);
    z-index: 100;
    flex-shrink: 0;
  }

  .tm {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
  }

  .tm-lbl {
    font-family: 'JetBrains Mono', monospace;
    font-size: 7.5px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    width: 64px;
    flex-shrink: 0;
  }

  .tm-track {
    flex: 1;
    height: 2px;
    background: rgba(212, 165, 116, 0.06);
    border-radius: 2px;
    overflow: hidden;
  }

  .tm-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.6s ease;
  }

  .tm-val {
    font-family: 'JetBrains Mono', monospace;
    font-size: 7.5px;
    color: var(--text-dim);
    width: 20px;
    text-align: right;
  }

  .t-sep {
    width: 1px;
    height: 12px;
    background: var(--border);
    flex-shrink: 0;
  }

  .live-time {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8px;
    color: var(--text-dim);
    flex-shrink: 0;
    margin-left: auto;
  }
</style>
