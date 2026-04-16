# Extract ACE Desktop to Its Own Private Repo — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move `ace-desktop/` out of the `mythopoetix/nikhil` monorepo into its own private GitHub repo, preserving git history, while keeping the public `actualize-ace/ace-desktop` downloads page unchanged.

**Architecture:** Use `git filter-repo` to surgically carve `ace-desktop/` (with its full history) into a standalone repo. Move the release workflow with it, adjusted to drop the `ace-desktop/` working-directory prefix. The release CI continues publishing installers to the public downloads repo via the same `PUBLIC_REPO_TOKEN` PAT. Source code never becomes public. The vault repo gets a clean delete of `ace-desktop/` and `.github/workflows/release.yml`.

**Tech Stack:** `git filter-repo` (history surgery), GitHub CLI (`gh`), existing Electron + electron-builder CI.

**Precondition checks before starting:**
- `git filter-repo` installed (`brew install git-filter-repo`)
- Working tree clean on both `mythopoetix/nikhil` and any open ace-desktop branches
- No in-flight PRs/tags on ace-desktop (check `git tag --list 'ace-desktop-v*'`)
- All memory entries referencing the old path noted (we'll update them at the end)

**Decisions locked:**
- New private repo name: `actualize-ace/ace-desktop-source` (under the Actualize org, where the public downloads repo already lives — keeps related things together)
- Local clone location: `~/Documents/ace-desktop/` (sibling to the vault, not nested inside it)
- Public downloads repo: unchanged, keeps name `actualize-ace/ace-desktop`

---

## Task 1: Pre-flight safety + backup

**Files:** none (git operations only)

**Step 1: Verify clean working tree on vault**

Run: `cd ~/Documents/Actualize && git status --short`
Expected: output only shows untracked files you're comfortable with; no staged or unstaged changes to `ace-desktop/`.

If dirty: stash or commit first. Do not proceed with dirty working tree.

**Step 2: Create a tagged backup of current main**

Run: `git tag backup/pre-ace-desktop-extract-2026-04-13 && git push origin backup/pre-ace-desktop-extract-2026-04-13`
Expected: tag created locally and pushed to `mythopoetix/nikhil`. This is your escape hatch — if anything goes wrong you can reset to it.

**Step 3: Install git-filter-repo if missing**

Run: `which git-filter-repo || brew install git-filter-repo`
Expected: path to binary printed, or brew install completes successfully.

**Step 4: Verify tool works**

Run: `git filter-repo --version`
Expected: version string printed (not an error).

**Step 5: Record the list of ace-desktop tags to preserve**

Run: `git tag --list 'ace-desktop-v*' > /tmp/ace-desktop-tags.txt && cat /tmp/ace-desktop-tags.txt`
Expected: file shows `ace-desktop-v0.1.0`, `ace-desktop-v0.1.1`, `ace-desktop-v0.1.2`, `ace-desktop-v0.1.3`, plus the rc tags. These must survive the migration.

**No commit yet — this task is preparation only.**

---

## Task 2: Create the new private source repo on GitHub (manual step — user confirms)

**Files:** none (GitHub web UI or `gh`)

**Step 1: Create the repo via gh**

Run:
```bash
gh repo create actualize-ace/ace-desktop-source \
  --private \
  --description "ACE Desktop — Electron app source. Publishes installers to actualize-ace/ace-desktop." \
  --confirm
```
Expected: URL printed, repo exists at https://github.com/actualize-ace/ace-desktop-source (private).

**Step 2: Verify the repo is empty and private**

Run: `gh repo view actualize-ace/ace-desktop-source --json visibility,isEmpty`
Expected: `{"visibility":"PRIVATE","isEmpty":true}`

**Step 3: User checkpoint**

STOP. Confirm with user that the new repo name is correct before doing any history surgery. If they'd rather use `mythopoetix/ace-desktop` (personal account) or a different name, adjust and re-run Step 1.

---

## Task 3: Carve out ace-desktop/ with full history into a scratch clone

**Files:** working inside `/tmp/ace-desktop-extract/` (scratch — safe to delete)

**Step 1: Make a fresh bare clone of the vault (does not touch your working repo)**

Run:
```bash
mkdir -p /tmp/ace-desktop-extract && cd /tmp/ace-desktop-extract
git clone --no-local ~/Documents/Actualize scratch
cd scratch
```
Expected: clone succeeds, you're inside `/tmp/ace-desktop-extract/scratch`.

Rationale: `--no-local` forces a real clone (not hardlinks), so the filter-repo rewrite cannot accidentally corrupt your real working repo.

**Step 2: Use filter-repo to keep only ace-desktop/ history, promoting it to repo root**

Run:
```bash
git filter-repo --subdirectory-filter ace-desktop --tag-rename 'ace-desktop-v:v'
```
Expected:
- All commits that didn't touch `ace-desktop/` are dropped.
- Paths like `ace-desktop/main.js` become `main.js`.
- Tags `ace-desktop-v0.1.3` become `v0.1.3` (clean version tags for the new repo).
- No errors. filter-repo prints a summary.

**Step 3: Verify the rewrite**

Run: `git log --oneline | head -20 && git tag --list | sort`
Expected: commits are all ace-desktop-related, tags are `v0.1.0` through `v0.1.3` plus rc variants.

Run: `ls`
Expected: `main.js`, `package.json`, `renderer/`, `src/`, etc. — the contents of ace-desktop/ now at repo root. No `00-System/`, no `01-Journal/`.

**Step 4: Point the remote at the new private repo**

Run:
```bash
git remote remove origin
git remote add origin git@github.com:actualize-ace/ace-desktop-source.git
```
Expected: no output (success).

**Step 5: Push everything**

Run: `git push -u origin main && git push origin --tags`
Expected: main branch and all v* tags uploaded. Repo is no longer empty.

**Step 6: Verify on GitHub**

Run: `gh repo view actualize-ace/ace-desktop-source --json isEmpty,defaultBranchRef`
Expected: `isEmpty: false`, `defaultBranchRef.name: main`.

**No vault commit yet — we're still scratch-only. Real vault changes happen in Task 6.**

---

## Task 4: Rewire the release workflow inside the new repo

**Files:**
- Modify (in the new repo clone): `.github/workflows/release.yml`

**Step 1: Still inside the scratch clone, edit release.yml**

The existing workflow assumes `ace-desktop/` is a subdirectory. Now that ace-desktop is the repo root, strip the `working-directory: ace-desktop` lines and the `cache-dependency-path: ace-desktop/package-lock.json` prefix. Also update the tag pattern from `ace-desktop-v*` to `v*`.

Exact changes to `/tmp/ace-desktop-extract/scratch/.github/workflows/release.yml`:

Replace:
```yaml
    tags:
      - 'ace-desktop-v*'
```
With:
```yaml
    tags:
      - 'v*'
```

Replace every occurrence of:
```yaml
          cache-dependency-path: ace-desktop/package-lock.json
```
With:
```yaml
          cache-dependency-path: package-lock.json
```

Remove every line that reads:
```yaml
        working-directory: ace-desktop
```

Update path references in the `path:` keys for artifacts from `ace-desktop/dist/*.dmg` → `dist/*.dmg` (and same for .exe).

In the publish job, update the version extraction:
```yaml
      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"
```

And the release create call's tag naming — the public repo has historically used `ace-desktop-v*` tag names. Keep that for continuity:
```yaml
        run: |
          gh release create "ace-desktop-$GITHUB_REF_NAME" \
            --repo actualize-ace/ace-desktop \
            --title "ACE v$VERSION" \
            ...
```

**Step 2: Commit the workflow changes**

Run:
```bash
git add .github/workflows/release.yml
git commit -m "ci: adapt release workflow for standalone repo layout"
git push origin main
```
Expected: commit pushed, workflow updated on remote.

**Step 3: Add the PUBLIC_REPO_TOKEN secret to the new repo**

The same fine-grained PAT used today must be re-added to the new repo. Retrieve the token value from 1Password (or wherever it lives), then:

Run:
```bash
gh secret set PUBLIC_REPO_TOKEN --repo actualize-ace/ace-desktop-source
```
(Paste token when prompted.)

Expected: `✓ Set secret PUBLIC_REPO_TOKEN for actualize-ace/ace-desktop-source`

**Step 4: Verify the secret exists**

Run: `gh secret list --repo actualize-ace/ace-desktop-source`
Expected: `PUBLIC_REPO_TOKEN` appears in the list.

---

## Task 5: Clone the new repo to its permanent local location and smoke-test a build

**Files:** creating `~/Documents/ace-desktop/` (new working directory)

**Step 1: Clone to the permanent home**

Run:
```bash
cd ~/Documents
git clone git@github.com:actualize-ace/ace-desktop-source.git ace-desktop
cd ace-desktop
```
Expected: clone succeeds at `~/Documents/ace-desktop/`.

**Step 2: Install dependencies (rebuilds native modules for your Mac)**

Run: `npm ci`
Expected: install completes, postinstall's `electron-rebuild` succeeds, no errors.

**Step 3: Launch the app locally**

Run: `npm start`
Expected: ACE Desktop window opens, loads your vault correctly (assuming vault path config is user-level, not repo-level — per memory `feedback_ace_desktop_dual_config.md`).

**Step 4: Quit the app, stage a no-op commit to verify CI wiring (optional)**

Skipped unless something looks off. Go straight to Task 6.

---

## Task 6: Test the release pipeline end-to-end with a dry-run tag

**Files:** none (git operations in `~/Documents/ace-desktop/`)

**Step 1: Bump package.json to a test version**

Edit `package.json` in `~/Documents/ace-desktop/`, change `"version": "0.1.3"` to `"version": "0.1.4-rc1"`.

**Step 2: Commit and push**

Run:
```bash
git add package.json
git commit -m "chore: bump to 0.1.4-rc1 for CI smoke test"
git push origin main
```

**Step 3: Tag and push the tag**

Run:
```bash
git tag v0.1.4-rc1
git push origin v0.1.4-rc1
```
Expected: tag push triggers the workflow.

**Step 4: Watch the workflow**

Run: `gh run watch --repo actualize-ace/ace-desktop-source`
Expected: build-mac (both arches), build-win, and publish jobs all complete successfully. Total ~5 minutes.

**Step 5: Verify the release appeared on the public downloads repo**

Run: `gh release view ace-desktop-v0.1.4-rc1 --repo actualize-ace/ace-desktop`
Expected: release exists, three assets attached (`ACE-0.1.4-rc1-arm64.dmg`, `ACE-0.1.4-rc1-x64.dmg`, `ACE-0.1.4-rc1-x64.exe`).

**Step 6: If smoke test passed, mark the rc release as pre-release and move on**

Run: `gh release edit ace-desktop-v0.1.4-rc1 --repo actualize-ace/ace-desktop --prerelease`
Expected: release flagged as pre-release (won't show up as "Latest" to users).

**If anything failed:** stop here. The vault is still intact, the old pipeline still works. Debug in the new repo without touching the vault.

---

## Task 7: Delete ace-desktop/ and release.yml from the vault

**Files:**
- Delete: `ace-desktop/` (entire directory, in `~/Documents/Actualize/`)
- Delete: `.github/workflows/release.yml`
- Modify: `.gitignore` (remove any `ace-desktop/`-specific lines, if present)
- Modify: `CLAUDE.md` (update any references to `ace-desktop/` paths)

**Step 1: Verify you are in the vault working directory**

Run: `cd ~/Documents/Actualize && pwd && ls 00-System/state.md`
Expected: `/Users/nikhilkale/Documents/Actualize`, and `state.md` exists. You are in the vault, not in the new ace-desktop clone.

**Step 2: Verify the new repo has everything the vault version had**

Run:
```bash
diff -rq ~/Documents/Actualize/ace-desktop ~/Documents/ace-desktop \
  --exclude=node_modules --exclude=dist --exclude=.git --exclude=.DS_Store
```
Expected: no differences (or only ignorable ones like .DS_Store if you didn't exclude it). If there are real diffs, **stop** — you have uncommitted work in the vault copy that wasn't included in the filter-repo rewrite.

**Step 3: Remove ace-desktop/ from the vault**

Run:
```bash
git rm -r ace-desktop
git rm .github/workflows/release.yml
```
Expected: both removals staged.

**Step 4: Check .gitignore and CLAUDE.md for references**

Run: `grep -n 'ace-desktop' .gitignore CLAUDE.md`
Expected: surface any lines that mention `ace-desktop/` paths.

For CLAUDE.md, update any path references to point to the new location (`~/Documents/ace-desktop/`) OR simply remove — ace-desktop is no longer part of this repo's concern.

For .gitignore, remove any `ace-desktop/`-scoped ignores (they're dead weight now).

**Step 5: Commit the removal**

Run:
```bash
git commit -m "chore: extract ace-desktop to actualize-ace/ace-desktop-source (private)

ace-desktop source code moved to its own private repo. Release CI
follows. This repo is now vault + non-ace products only.

Migration plan: ace-desktop/docs/plans/2026-04-13-extract-ace-desktop-to-own-repo.md
(lives in the new repo now)"
git push origin main
```

**Step 6: Verify nothing else in the vault depends on ace-desktop/**

Run: `grep -rn 'ace-desktop/' --include='*.md' --include='*.json' --include='*.sh' . | head -20`
Expected: only historical references in execution logs / journal entries (fine), no active scripts or configs pointing at the deleted path.

If anything active still references the old path, fix it in this same commit or a follow-up.

---

## Task 8: Update auto-memory + housekeeping

**Files:**
- Modify: `~/.claude/projects/-Users-nikhilkale-Documents-Actualize/memory/project_desktop_client_ship_sprint.md`
- Modify: `~/.claude/projects/-Users-nikhilkale-Documents-Actualize/memory/feedback_multi_app_git_scoping.md`
- Modify: `~/.claude/projects/-Users-nikhilkale-Documents-Actualize/memory/MEMORY.md` (if any pointers change)
- Possibly new: `~/.claude/projects/.../memory/reference_ace_desktop_repo_layout.md`

**Step 1: Update project_desktop_client_ship_sprint.md**

Change references from "this repo" to the new repo. Note the migration date and the new URL.

**Step 2: Relax feedback_multi_app_git_scoping.md**

The rule becomes weaker — ACE Desktop is now isolated. Aurora and ace-web still share the vault, so the scoping rule remains partially relevant. Rewrite accordingly.

**Step 3: Create reference_ace_desktop_repo_layout.md**

Capture: source = `actualize-ace/ace-desktop-source` (private), downloads = `actualize-ace/ace-desktop` (public), local clone = `~/Documents/ace-desktop/`, tag scheme = `v*` in source repo → `ace-desktop-v*` on downloads.

**Step 4: Bump the memory pointers in MEMORY.md as needed**

**Step 5: Run /memory-sync to push to Hindsight**

Per `feedback_memory_hygiene.md`.

**Step 6: Final verification**

- Run `ls ~/Documents/Actualize/ace-desktop` → should error (no such directory).
- Run `ls ~/Documents/ace-desktop/main.js` → should succeed.
- Run `gh run list --repo actualize-ace/ace-desktop-source --limit 3` → recent successful workflow.
- Run `gh release list --repo actualize-ace/ace-desktop --limit 3` → shows the rc release you cut in Task 6.

---

## Rollback plan (if something breaks mid-migration)

If Task 5 or Task 6 reveals a problem with the extracted repo:
1. **Do not run Task 7.** The vault still has `ace-desktop/` intact.
2. Delete the new repo: `gh repo delete actualize-ace/ace-desktop-source --yes`
3. Delete the local clone: `rm -rf ~/Documents/ace-desktop`
4. Old pipeline continues to work from the vault.

If Task 7 has already been run and something surfaces later:
1. `git reset --hard backup/pre-ace-desktop-extract-2026-04-13` (the tag from Task 1)
2. `git push --force-with-lease origin main` (discuss before running — destructive)
3. Re-attempt the extraction once the issue is understood.

---

## What changes for you day-to-day

- **Editing ace-desktop code:** `cd ~/Documents/ace-desktop` instead of `cd ~/Documents/Actualize/ace-desktop`. Open a separate VS Code / Claude Code session there.
- **Committing ace-desktop work:** normal — it's its own repo, can `git add .` freely.
- **Committing vault work:** still need to be careful with Aurora / ace-web / other products still in the vault, but ace-desktop is no longer a concern.
- **Releasing a new version:** bump `package.json` in `~/Documents/ace-desktop`, tag `v0.1.X`, push. Installers land in the public repo same as before.
- **First-run frictions to expect:** need to re-approve GitHub SSH access, re-authenticate for private repo clone, reinstall node_modules in the new location.
