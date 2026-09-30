# Upstream issue drafts: create-cloudinary-next on Windows

Two bugs we hit while scaffolding Snap2Shelf with `npx create-cloudinary-next --headless` on Windows 11 (late September 2026). Neither is filed yet. File each one on the create-cloudinary-next repository, then put the issue links in `README.md` ("How we built it with AI") and `docs/SURVEY_ANSWERS.md` (product feedback, items 1 and 2).

Fill in the two version lines from your own machine before filing (`npx create-cloudinary-next --version` if the CLI supports it, otherwise the version npm resolved; `node --version`). Nothing below is secret.

---

## 1. `spawnSync npx ENOENT` on Windows

**Title:** CLI fails on Windows with `spawnSync npx ENOENT` (npx launched without a shell)

**Environment**
- OS: Windows 11
- Node.js: `<node --version>`
- create-cloudinary-next: `<version>`
- Command: `npx create-cloudinary-next --headless`

**What happens.** The step that runs `npx` fails with:

```text
Error: spawnSync npx ENOENT
```

**Why.** The CLI calls `spawnSync("npx", …)` without a shell. On Windows, `npx` is a `.cmd` shim, and `child_process.spawnSync` can't resolve a `.cmd` file without a shell, so the call fails with `ENOENT` even though `npx` works in the same terminal.

**Expected.** The same command completes on Windows as it does on macOS and Linux.

**Suggested fix.** Run it through a shell on Windows:

```js
spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
```

(Calling `npx.cmd` directly without a shell is not a safe alternative: recent Node.js releases refuse to spawn `.cmd` and `.bat` files without `shell: true`.)

---

## 2. Skills Pack install finds no skills (the lookup skips subfolders)

**Title:** Skills Pack step installs nothing: it looks for `skills/<name>`, but cloudinary-devs/skills keeps skills in subfolders

**Environment**
- OS: Windows 11 (the path logic doesn't look Windows-specific)
- create-cloudinary-next: `<version>`
- Command: `npx create-cloudinary-next --headless`, with the Skills Pack option on

**What happens.** The step that installs the Cloudinary Skills Pack finishes without installing any skill.

**Why.** The installer looks for each skill directly under `skills/<name>`, but `cloudinary-devs/skills` keeps them one level deeper, under `skills/frameworks/…` and `skills/platform/…`. The `skillPath` values that `npx skills add cloudinary-devs/skills` recorded in our [`skills-lock.json`](../skills-lock.json) show the real layout:

```text
skills/platform/cloudinary-docs/SKILL.md
skills/frameworks/cloudinary-next/SKILL.md
skills/frameworks/cloudinary-react/SKILL.md
skills/platform/cloudinary-transformations/SKILL.md
```

**Expected.** The four skills (`cloudinary-docs`, `cloudinary-next`, `cloudinary-react`, `cloudinary-transformations`) end up in `.claude/skills/`.

**Workaround.** `npx skills add cloudinary-devs/skills` installs them correctly.

**Suggested fix.** Search `skills/**/<name>/SKILL.md` (or read the pack's own index) instead of assuming `skills/<name>`.
