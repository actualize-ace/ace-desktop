// renderer/modules/chat-renderer.js
// Pure rendering utilities — no DOM or state dependencies (except postProcessCodeBlocks).

export const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','a','ul','ol','li',
    'blockquote','code','pre','strong','em','del','s','table',
    'thead','tbody','tr','th','td','hr','br','span','div',
    'input','details','summary','mark','sub','sup'],
  ALLOWED_ATTR: ['href','class','id','data-target','title','colspan','rowspan','type','checked','disabled'],
}

// Syntax highlighting — lightweight regex-based
export const HL_LANGS = {
  javascript: { kw: ['const','let','var','function','return','if','else','for','while','class','import','export','from','async','await','new','this','try','catch','throw','switch','case','default','break','continue','typeof','instanceof','of','true','false','null','undefined','yield'], line:'//', bs:'/*', be:'*/' },
  typescript: null, // alias
  python: { kw: ['def','class','import','from','return','if','elif','else','for','while','try','except','finally','with','as','yield','lambda','True','False','None','and','or','not','in','is','pass','raise','break','continue','global','nonlocal','assert','del','async','await'], line:'#' },
  bash: { kw: ['if','then','else','elif','fi','for','do','done','while','until','case','esac','function','return','exit','echo','export','source','local','readonly','declare','set','unset','true','false','cd','ls','rm','mv','cp','mkdir','cat','grep','sed','awk','curl','sudo','chmod','chown'], line:'#' },
  shell: null, // alias
  sh: null,
  json: { kw: ['true','false','null'] },
  html: { kw: [] },
  xml: null,
  css: { kw: ['import','media','keyframes','font-face','supports','charset'] },
  go: { kw: ['func','package','import','return','if','else','for','range','switch','case','default','break','continue','var','const','type','struct','interface','map','chan','go','defer','select','true','false','nil','make','len','append','error','string','int','bool','byte','float64'], line:'//', bs:'/*', be:'*/' },
  rust: { kw: ['fn','let','mut','pub','use','mod','struct','enum','impl','trait','match','if','else','for','while','loop','return','break','continue','true','false','self','Self','super','crate','as','in','ref','move','async','await','where','type','const','static','unsafe','extern'], line:'//', bs:'/*', be:'*/' },
  sql: { kw: ['SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','ALTER','DROP','INDEX','JOIN','LEFT','RIGHT','INNER','OUTER','ON','AND','OR','NOT','NULL','IS','IN','LIKE','ORDER','BY','GROUP','HAVING','LIMIT','OFFSET','AS','DISTINCT','COUNT','SUM','AVG','MAX','MIN','UNION','EXISTS','BETWEEN','CASE','WHEN','THEN','ELSE','END','PRIMARY','KEY','FOREIGN','REFERENCES','CASCADE','TRUE','FALSE'], line:'--' },
  yaml: { kw: ['true','false','null','yes','no','on','off'] },
  markdown: { kw: [] },
  md: null,
}
HL_LANGS.typescript = HL_LANGS.javascript
HL_LANGS.shell = HL_LANGS.bash
HL_LANGS.sh = HL_LANGS.bash
HL_LANGS.xml = HL_LANGS.html
HL_LANGS.md = HL_LANGS.markdown
HL_LANGS.jsx = HL_LANGS.javascript
HL_LANGS.tsx = HL_LANGS.typescript
HL_LANGS.zsh = HL_LANGS.bash

export function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

export function syntaxHighlight(code, lang) {
  const def = HL_LANGS[(lang || '').toLowerCase()]
  if (!def) return escapeHtml(code)
  const kwSet = new Set(def.kw || [])
  const kwSetLower = new Set((def.kw || []).map(k => k.toLowerCase()))
  const isSQL = lang.toLowerCase() === 'sql'
  let result = '', i = 0
  while (i < code.length) {
    // Block comment
    if (def.bs && code.startsWith(def.bs, i)) {
      const end = code.indexOf(def.be, i + def.bs.length)
      const slice = end >= 0 ? code.slice(i, end + def.be.length) : code.slice(i)
      result += `<span class="hl-comment">${escapeHtml(slice)}</span>`
      i += slice.length; continue
    }
    // Line comment
    if (def.line && code.startsWith(def.line, i) && (i === 0 || code[i-1] === '\n' || code[i-1] === ' ' || code[i-1] === '\t' || code[i-1] === ';' || code[i-1] === ')' || code[i-1] === '}')) {
      const nl = code.indexOf('\n', i)
      const slice = nl >= 0 ? code.slice(i, nl) : code.slice(i)
      result += `<span class="hl-comment">${escapeHtml(slice)}</span>`
      i += slice.length; continue
    }
    // Strings
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const q = code[i]; let j = i + 1
      while (j < code.length && code[j] !== q) { if (code[j] === '\\') j++; j++ }
      const slice = code.slice(i, j + 1)
      result += `<span class="hl-string">${escapeHtml(slice)}</span>`
      i = j + 1; continue
    }
    // Numbers
    if (/[0-9]/.test(code[i]) && (i === 0 || /[\s,\(\[\{:=+\-*/<>!&|^~%]/.test(code[i-1]))) {
      let j = i; while (j < code.length && /[0-9a-fA-Fx._]/.test(code[j])) j++
      result += `<span class="hl-number">${escapeHtml(code.slice(i, j))}</span>`
      i = j; continue
    }
    // Words (keywords, functions)
    if (/[a-zA-Z_$@]/.test(code[i])) {
      let j = i; while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++
      const word = code.slice(i, j)
      const isKw = isSQL ? kwSetLower.has(word.toLowerCase()) : kwSet.has(word)
      if (isKw) {
        result += `<span class="hl-keyword">${escapeHtml(word)}</span>`
      } else if (j < code.length && code[j] === '(') {
        result += `<span class="hl-function">${escapeHtml(word)}</span>`
      } else {
        result += escapeHtml(word)
      }
      i = j; continue
    }
    result += escapeHtml(code[i]); i++
  }
  return result
}

// Settled boundary — find safe split point for partial markdown
export function findSettledBoundary(text) {
  // Count code fences
  let inFence = false, fenceChar = '', fenceLen = 0
  const lines = text.split('\n')
  let lastSafeLine = -1
  for (let li = 0; li < lines.length; li++) {
    const trimmed = lines[li].trimStart()
    const m = trimmed.match(/^(`{3,}|~{3,})/)
    if (m) {
      if (!inFence) { inFence = true; fenceChar = m[1][0]; fenceLen = m[1].length }
      else if (trimmed[0] === fenceChar && m[1].length >= fenceLen) { inFence = false; lastSafeLine = li }
    } else if (!inFence) {
      // A blank line outside a fence is a safe boundary
      if (trimmed === '' && li > 0) lastSafeLine = li
    }
  }
  if (inFence) {
    // Find position just before the opening fence
    let pos = 0
    for (let li = 0; li < lines.length; li++) {
      const trimmed = lines[li].trimStart()
      if (trimmed.match(/^(`{3,}|~{3,})/)) {
        // Walk back to find the last blank line before this fence
        for (let k = li - 1; k >= 0; k--) {
          if (lines[k].trim() === '') { lastSafeLine = k; break }
        }
        break
      }
      pos += lines[li].length + 1
    }
  }
  if (lastSafeLine < 0) return 0
  let boundary = 0
  for (let li = 0; li <= lastSafeLine; li++) boundary += lines[li].length + 1
  return boundary
}

// Render partial tail (not yet settled)
export function renderTail(text) {
  if (!text) return ''
  // Check for partial code fence
  const fenceMatch = text.match(/^(`{3,}|~{3,})(\w*)\n?/m)
  if (fenceMatch) {
    const fenceStart = text.indexOf(fenceMatch[0])
    const before = text.slice(0, fenceStart)
    const codeContent = text.slice(fenceStart + fenceMatch[0].length)
    const lang = fenceMatch[2] || 'code'
    const highlighted = syntaxHighlight(codeContent, lang)
    let html = ''
    if (before.trim()) html += `<p>${escapeHtml(before).replace(/\n/g, '<br>')}</p>`
    html += `<div class="code-block-wrapper streaming"><div class="code-block-header"><span class="code-lang">${escapeHtml(lang)}</span><span class="chat-streaming-dot"></span></div><pre><code>${highlighted}</code></pre></div>`
    return html
  }
  // Regular text — basic inline formatting
  let html = escapeHtml(text)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  html = html.replace(/\n/g, '<br>')
  return `<p>${html}</p>`
}

// Post-process code blocks — add wrappers, copy buttons, syntax highlighting
export function postProcessCodeBlocks(container) {
  container.querySelectorAll('pre > code').forEach(codeEl => {
    if (codeEl.closest('.code-block-wrapper')) return
    const pre = codeEl.parentElement
    const langClass = [...codeEl.classList].find(c => c.startsWith('language-'))
    const lang = langClass ? langClass.replace('language-', '') : ''
    // Apply syntax highlighting
    if (lang && HL_LANGS[lang.toLowerCase()]) {
      codeEl.innerHTML = syntaxHighlight(codeEl.textContent, lang)
    }
    // Wrap
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper'
    const header = document.createElement('div')
    header.className = 'code-block-header'
    header.innerHTML = `<span class="code-lang">${escapeHtml(lang || 'code')}</span><button class="code-copy-btn">Copy</button>`
    header.querySelector('.code-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(codeEl.textContent)
      const btn = header.querySelector('.code-copy-btn')
      btn.textContent = 'Copied!'
      setTimeout(() => btn.textContent = 'Copy', 1500)
    })
    pre.parentNode.insertBefore(wrapper, pre)
    wrapper.appendChild(header)
    wrapper.appendChild(pre)
  })
}

// Process wikilinks
export function processWikilinks(text) {
  return text.replace(/\[\[([^\]|#\n]+?)(?:\|([^\]\n]+?))?\]\]/g, (_, target, display) => {
    const label = (display || target).replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const t = target.replace(/"/g, '&quot;')
    return `<span class="wikilink" data-target="${t}">${label}</span>`
  })
}
