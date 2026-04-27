# Build-Vault Permissions Seed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure every new client vault ships with a committed baseline `.claude/settings.json` so clients never hit permission-prompt blocks on first WebFetch or git push. Retrofit 5 existing client vaults that are missing it. Update `.gitignore` to keep accumulated runtime permissions out of git.

**Architecture:** The `build-vault` SKILL.md already has a heredoc that writes `.claude/settings.json`. It just never commits it. Adding two git commands after the write and one `.gitignore` line to the repo template closes the gap. Retrofitting existing vaults = write the file + commit, no build steps, no app restart.

**Tech Stack:** Markdown skill editing, bash git commands. No Electron app involved — this plan runs fully in parallel with desktop changes.

**Affected client vaults:** Eliana (`eliana-ace`), Craig (`craig-young-ace`), Aleksander (`aleksander-ace`), Patrick (`patrick-varden-ace`), Kim (`kim-bamford-ace`). Marc + Joe already have tracked settings.json — skip.

---

### Task 1: Update build-vault SKILL.md — commit the seeded file

**Files:**
- Modify: `.claude/skills/build-vault/SKILL.md` — the "Seed `.claude/settings.json`" block (around line 202-225)

**Step 1: Find the exact location**

Search for the heredoc block in the SKILL.md:
```
cat > "$VAULT_PATH/.claude/settings.json" << 'EOF'
```
It's in the section "Seed `.claude/settings.json`" between "Post-Clone Verification" and Step 5.

**Step 2: Add the commit instruction after the heredoc**

The current block ends with:
```bash
EOF
```

Immediately after, add:

```bash
# Commit the baseline so clients get it on clone — not just on fresh setup
git -C "$VAULT_PATH" add .claude/settings.json
git -C "$VAULT_PATH" commit -m "seed: baseline claude permissions (WebFetch + git)"
```

**Step 3: Add settings.local.json to .gitignore**

In the same SKILL.md section (or in the onboard-client.sh invocation block), ensure `.gitignore` in the client vault contains `.claude/settings.local.json`. This prevents accumulated runtime permissions from leaking into git.

Find where the vault `.gitignore` is written or referenced. Add this to its content:

```
# Claude runtime permissions — machine-specific, never commit
.claude/settings.local.json
```

If the `.gitignore` is created by `onboard-client.sh`, add the line there. If it's written inline in the SKILL.md, add it to that block.

**Step 4: Update the Constraints section**

Find the Constraints block (~line 643):
```
- **Always seed `.claude/settings.json`.** Write WebFetch + git permissions immediately after onboard-client.sh completes. See Post-Clone Verification step.
```

Update to:
```
- **Always seed `.claude/settings.json`.** Write WebFetch + git permissions immediately after onboard-client.sh completes. Commit it (`git add .claude/settings.json && git commit`) so the file ships with the repo on clone. Add `.claude/settings.local.json` to `.gitignore` so accumulated runtime permissions stay local. See Post-Clone Verification step.
```

**Step 5: Commit the skill update**

```bash
cd /Users/nikhilkale/Documents/Actualize
git add .claude/skills/build-vault/SKILL.md
git commit -m "fix(build-vault): commit baseline settings.json on vault creation + gitignore local overrides"
```

---

### Task 2: Retrofit Eliana's vault

**Files:**
- Create: `/Users/nikhilkale/Documents/eliana-ace/.claude/settings.json`
- Modify: `/Users/nikhilkale/Documents/eliana-ace/.gitignore` (add settings.local.json exclusion)

**Step 1: Write the baseline settings.json**

```bash
cat > /Users/nikhilkale/Documents/eliana-ace/.claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "WebFetch",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git pull:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git fetch:*)",
      "Bash(git checkout:*)",
      "Bash(git branch:*)",
      "Bash(gh *)"
    ]
  }
}
EOF
```

**Step 2: Add settings.local.json to .gitignore**

Check if `.gitignore` exists in eliana-ace. If so, append to it. If not, create it:

```bash
echo ".claude/settings.local.json" >> /Users/nikhilkale/Documents/eliana-ace/.gitignore
```

**Step 3: Commit**

```bash
git -C /Users/nikhilkale/Documents/eliana-ace add .claude/settings.json .gitignore
git -C /Users/nikhilkale/Documents/eliana-ace commit -m "seed: baseline claude permissions + gitignore local overrides"
git -C /Users/nikhilkale/Documents/eliana-ace push
```

**Step 4: Verify**

```bash
git -C /Users/nikhilkale/Documents/eliana-ace ls-files .claude/settings.json
```

Expected: `.claude/settings.json` (tracked)

---

### Task 3: Retrofit Craig's vault

Same steps as Task 2, with path `/Users/nikhilkale/Documents/craig-young-ace`.

**Step 1: Write settings.json**

```bash
cat > /Users/nikhilkale/Documents/craig-young-ace/.claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "WebFetch",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git pull:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git fetch:*)",
      "Bash(git checkout:*)",
      "Bash(git branch:*)",
      "Bash(gh *)"
    ]
  }
}
EOF
```

**Step 2: Gitignore**

```bash
echo ".claude/settings.local.json" >> /Users/nikhilkale/Documents/craig-young-ace/.gitignore
```

**Step 3: Commit + push**

```bash
git -C /Users/nikhilkale/Documents/craig-young-ace add .claude/settings.json .gitignore
git -C /Users/nikhilkale/Documents/craig-young-ace commit -m "seed: baseline claude permissions + gitignore local overrides"
git -C /Users/nikhilkale/Documents/craig-young-ace push
```

---

### Task 4: Retrofit Aleksander's vault

Path: `/Users/nikhilkale/Documents/aleksander-ace`

**Step 1: Write settings.json**

```bash
cat > /Users/nikhilkale/Documents/aleksander-ace/.claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "WebFetch",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git pull:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git fetch:*)",
      "Bash(git checkout:*)",
      "Bash(git branch:*)",
      "Bash(gh *)"
    ]
  }
}
EOF
```

**Step 2: Gitignore**

```bash
echo ".claude/settings.local.json" >> /Users/nikhilkale/Documents/aleksander-ace/.gitignore
```

**Step 3: Commit + push**

```bash
git -C /Users/nikhilkale/Documents/aleksander-ace add .claude/settings.json .gitignore
git -C /Users/nikhilkale/Documents/aleksander-ace commit -m "seed: baseline claude permissions + gitignore local overrides"
git -C /Users/nikhilkale/Documents/aleksander-ace push
```

---

### Task 5: Retrofit Patrick's vault

Path: `/Users/nikhilkale/Documents/patrick-varden-ace`

**Step 1: Write settings.json**

```bash
cat > /Users/nikhilkale/Documents/patrick-varden-ace/.claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "WebFetch",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git pull:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git fetch:*)",
      "Bash(git checkout:*)",
      "Bash(git branch:*)",
      "Bash(gh *)"
    ]
  }
}
EOF
```

**Step 2: Gitignore**

```bash
echo ".claude/settings.local.json" >> /Users/nikhilkale/Documents/patrick-varden-ace/.gitignore
```

**Step 3: Commit + push**

```bash
git -C /Users/nikhilkale/Documents/patrick-varden-ace add .claude/settings.json .gitignore
git -C /Users/nikhilkale/Documents/patrick-varden-ace commit -m "seed: baseline claude permissions + gitignore local overrides"
git -C /Users/nikhilkale/Documents/patrick-varden-ace push
```

---

### Task 6: Retrofit Kim's vault

Path: `/Users/nikhilkale/Documents/kim-bamford-ace`

**Step 1: Write settings.json**

```bash
cat > /Users/nikhilkale/Documents/kim-bamford-ace/.claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "WebFetch",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git pull:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git fetch:*)",
      "Bash(git checkout:*)",
      "Bash(git branch:*)",
      "Bash(gh *)"
    ]
  }
}
EOF
```

**Step 2: Gitignore**

```bash
echo ".claude/settings.local.json" >> /Users/nikhilkale/Documents/kim-bamford-ace/.gitignore
```

**Step 3: Commit + push**

```bash
git -C /Users/nikhilkale/Documents/kim-bamford-ace add .claude/settings.json .gitignore
git -C /Users/nikhilkale/Documents/kim-bamford-ace commit -m "seed: baseline claude permissions + gitignore local overrides"
git -C /Users/nikhilkale/Documents/kim-bamford-ace push
```

---

## Execution Notes

- **This plan runs fully in parallel with desktop changes** — no `npm start` required, no Electron app involved
- **Order within this plan**: Tasks 1 (skill update) then 2-6 (retrofits) can run in parallel since they touch separate repos
- **Jordan Queior** (`jordan-queior-ace`): new client, vault may not exist yet or may be freshly built — check and apply if needed
- **Skip**: Marc (`marc-ace`) and Joe (`joe-ace`) — both already have tracked `settings.json`
- **After push**: notify clients to `git pull` on their next session to get the permissions file (Eliana + Patrick hit this today — priority)
