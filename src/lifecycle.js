// Minimal port of VS Code's DisposableStore. Tracks per-session resources
// (processes, timers, listeners) and disposes them as a single unit.

class DisposableStore {
  constructor() {
    this._toDispose = new Set()
    this._isDisposed = false
  }

  add(disposable) {
    if (this._isDisposed) {
      try { disposable.dispose?.() } catch (_) {}
      return disposable
    }
    this._toDispose.add(disposable)
    return disposable
  }

  delete(disposable) {
    this._toDispose.delete(disposable)
    try { disposable.dispose?.() } catch (_) {}
  }

  dispose() {
    if (this._isDisposed) return
    this._isDisposed = true
    for (const d of this._toDispose) {
      try { d.dispose?.() } catch (_) {}
    }
    this._toDispose.clear()
  }
}

function toDisposable(fn) {
  return { dispose: fn }
}

module.exports = { DisposableStore, toDisposable }
