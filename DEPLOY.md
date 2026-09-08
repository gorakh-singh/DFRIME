# Deploying this

You said you would run these steps yourself, so nothing here is automated. Read section 0 before running anything.

---

## 0. Read this first: your current git setup is unsafe to push from

Checked on this machine:

```
git rev-parse --show-toplevel   ->  C:/Users/gorak
git remote get-url origin       ->  https://github.com/gorakh-singh/Striver.git
git ls-files | wc -l            ->  1
```

**The git repository you are inside is rooted at your entire Windows home directory**, and it is wired to a remote called `Striver`. It currently tracks exactly one file, so it looks like it was created by accident, probably by running `git init` in the wrong place once.

That matters because from that repository, `git add .` would stage:

- `NTUSER.DAT` and `ntuser.dat.LOG1` / `LOG2`, your Windows registry hive
- `AppData/`, which holds application state and tokens for everything you have installed
- `.claude.json`, `.claude.json.backup`, `.cursor/`, `.copilot/`, `.gemini/`, `.continuum/`
- `Downloads/`, `Documents/`, `Contacts/`, `Favorites/`, `OneDrive/`
- `.ssh/` and `.aws/` if you have them

A `git push` after that would publish all of it. If the repo is public, it is published to the internet. If it is private, it is still uploaded to a third party and stays in the history even after a later delete.

**Do not run `git add .` or `git add -A` anywhere at or above `C:\Users\gorak`.**

I have not touched that repository. Two things worth doing separately from this deployment, at your convenience:

1. Decide whether you want a git repo at your home directory at all. If not, `rm -rf C:/Users/gorak/.git` removes it. That only deletes the repository metadata, not your files. Check `git -C C:/Users/gorak log` first in case there is history you want.
2. Check whether anything from your home directory was ever pushed to `Striver`, and rotate any credential that was.

The steps below deliberately create a **separate repository inside `rime/`**, so none of the above is in scope for anything you push.

---

## 1. Decide which deployment you want

| | Static host (GitHub Pages) | Node host (Render, Railway, Fly) |
| --- | --- | --- |
| All 17 fixtures, both variants | yes | yes |
| Stored clips play, with real provenance and timestamps | yes | yes |
| Waveforms, targets, translations, listening log | yes | yes |
| Measured control results and noise floors | yes | yes |
| **Live rendering ("Send live", "Render live")** | **no** | **yes** |
| Verdicts stored | in the viewer's browser | in `verdicts.json` on the server |
| Cost | free | free tier, sleeps when idle |
| Needs the API key on the host | no | yes |

Live rendering needs a server, because the server is what holds the API key. A static site has nowhere to put a key that is not also published to every visitor. `npm run build:static` therefore turns the live controls off and prints the reason on the page rather than pretending or quietly replaying a cached clip.

**Recommendation:** deploy to a Node host. One of the judging criteria is that part of the artifact is undeniably live rather than replayed, and that is the part a static deploy loses. If you want a backup URL as well, do both; they can coexist.

---

## 2. Create the repository (do this for either option)

Run these from inside `rime/`. The `git init` creates a **new, separate** repository whose root is `rime/`, so nothing above it can be staged.

```bash
cd C:/Users/gorak/DataForge/rime && git init -b main
```

Confirm the root is what you expect before going further. It must print the `rime` path, not `C:/Users/gorak`:

```bash
cd C:/Users/gorak/DataForge/rime && git rev-parse --show-toplevel
```

Now stage everything and check what you are about to commit:

```bash
cd C:/Users/gorak/DataForge/rime && git add . && git status --short
```

You should see about 62 paths, all under `rime/`, roughly 8.8 MB, most of it the 34 wav files. **Confirm `.env` is not among them.** This must print nothing:

```bash
cd C:/Users/gorak/DataForge/rime && git status --short | grep "\.env$"
```

If that command prints anything at all, stop and fix `.gitignore` before committing. It is listed there already, so it should print nothing.

Commit:

```bash
cd C:/Users/gorak/DataForge/rime && git commit -m "Written for the Ear: Rime pronunciation and controlled delivery"
```

Create an empty repository on GitHub (no README, no .gitignore, no licence, or the first push will be rejected), then:

```bash
cd C:/Users/gorak/DataForge/rime && git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main
```

---

## 3A. Node host, with live rendering

Render is the least fiddly of these. Railway and Fly.io work the same way.

1. Go to <https://dashboard.render.com>, **New** then **Web Service**, and connect the GitHub repo you just pushed.
2. Settings:
   - **Runtime:** Node
   - **Build command:** leave empty. There are no dependencies and no build step.
   - **Start command:** `npm start`
   - **Instance type:** Free
3. Under **Environment**, add one variable:
   - Key `RIME_API_KEY`, value your key from <https://app.rime.ai/tokens/>
   - Do not set `PORT`. The host sets it, and `server.mjs` reads `process.env.PORT`.
4. Deploy. The first boot takes a minute or two.

Check it worked by opening the URL. The hero's run configuration card should say `live calls: enabled, key present`, and **Send live** on any fixture should relabel that clip from Cached to Live with a fresh round-trip time.

Two things to know about free tiers:

- The instance sleeps after about 15 minutes idle and takes 30 to 60 seconds to wake. If you are demoing live, open the URL a minute beforehand.
- `verdicts.json` is written to the container's disk, which is wiped on redeploy and on wake from sleep. Verdicts recorded on the deployed site are not durable. Record your listening pass locally, where `verdicts.json` is a real file.

## 3B. GitHub Pages, static

Regenerate the frozen state first. Do this every time the fixtures or clips change, or the deployed site will serve a stale copy:

```bash
cd C:/Users/gorak/DataForge/rime && npm run generate && npm run build:static
```

Then commit `public/state.json` along with any changed clips.

Pages needs to serve the `public/` directory as the site root. The workflow at `.github/workflows/pages.yml` in this repo does that. To enable it: on GitHub go to **Settings**, **Pages**, and set **Source** to **GitHub Actions**. Push to `main` and the workflow publishes `public/` to `https://<you>.github.io/<repo>/`.

All paths in the page are relative, so it works under a project subpath with no base-path configuration.

Live controls will be off, with the reason printed on the page. That is correct behaviour, not a bug, and it is worth saying out loud in your demo rather than letting a judge discover it.

---

## 4. Before you show it to anyone

```bash
cd C:/Users/gorak/DataForge/rime && npm run preflight
```

16 checks. It re-derives every voice from Rime's live catalog and fails if any has drifted from what the clips were rendered with, verifies no fixture uses a mechanism its track lacks, and makes one real round trip per track.

Then, separately, run the organizer's own preflight. This script is the project's, and it does not stand in for theirs.

---

## 5. Key hygiene

- `rime/.env` is gitignored and `git check-ignore` confirms it. It is the only file on disk holding the key.
- The key is never sent to the browser. The page posts text to `/api/render`; the server holds the key and calls Rime.
- On a Node host, set the key as an environment variable in the host's dashboard. Never commit it, and do not paste it into a screen recording or a screenshot of a terminal.
- If a key is ever exposed, revoke it at <https://app.rime.ai/tokens/> and issue a new one. Revoking is the fix; deleting the commit is not, because the value stays in the history and in anyone's clone.
