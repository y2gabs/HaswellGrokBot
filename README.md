# Haswell Bots

A mobile-first web app, modelled on Grok Bot, that gives each Haswell site
owner a team of chat "teammates" for their WordPress subsite. Each bot does the
work conversationally and **always asks before changing anything**.

- **Marketing** suggests three announcement ideas and writes the article you
  pick. It then makes three featured-image options and, once you approve, posts
  the result to your site's **Announcements**.
- **Website Manager** changes your **website settings**: the ACF fields on the
  `website_settings` posts, such as company name, short and long tagline,
  phone, email and images. It also adds, changes and removes **services**,
  **team members** and **partners**. You can attach photos in the chat for
  image fields.

To dictate, tap the **mic** in the message box. It uses the browser's own
speech recognition, so words appear as you speak and it costs nothing. It works
in Chrome, Edge and Safari/iOS; Firefox doesn't have it, so the button is
hidden there. Dictation only fills the box: you still review it and tap Send.
The audio goes to the browser's speech service (Google in Chrome, Apple in
Safari), not through this app, and the site must be served over HTTPS.

```
Browser ─► Next.js app (this repo, on the VPS)
             ├─ DeepSeek V4 Flash: orchestration and writing
             ├─ OpenAI / Gemini: featured images
             └─ user's subsite REST, as the user (Application Password)
                  └─ wordpress/haswell-bots-companion (this repo)
```

## How it fits together

**Sign-in.** Users sign in on the app's own screen with their normal WordPress
username (or email) and password. The app's server passes these, with the
client secret, to the companion plugin (`haswell-bots/v1/login`), which checks
them with WordPress's own login check. The plugin then finds the subsites where
the user is an **Editor** or above. With one site, the user goes straight to the
home screen; with several, they pick one first. The plugin mints an Application
Password for that site. It lives only in an encrypted, httpOnly cookie, so each
user is automatically set up for their own subsite. Signing out revokes it.

- The password is used once and never stored.
- After 5 failed attempts for a username (or 20 from one visitor) within 15
  minutes, sign-in is locked for that username or visitor, and the error never
  reveals whether an account exists.
- "Forgot password?" opens WordPress's own reset page.
- "Use your website's sign-in page" falls back to WordPress's login page and
  a "Connect your website" page, for sites that need two-factor or social login
  there.

**Bots.** A turn is a DeepSeek tool loop (`lib/agent/loop.ts`), with three
kinds of tools (`lib/agent/tools.ts`):

- **Read tools** run straight away: settings, content lists and site context.
- **UI tools** end the turn with a card for the user to act on: idea chips or
  the image picker.
- **Proposal tools never write.** Each one first validates the change with the
  companion's `dryRun`. It then stores the exact request and shows an
  **approval card** with the before and after. Only **Approve** runs it
  (`lib/agent/actions.ts`), and it runs the stored request, not anything the
  model says afterwards.

**History.** Conversations are private posts on the user's own subsite (via
the companion plugin), so the app has no database. Turns run on the server
after the request returns, and the thread is saved after every step. If you
close the app mid-task, the finished result is waiting when you come back.

## Repository layout

| Path | What |
| --- | --- |
| `app/` | Pages (`/`, `/home`, `/chat/[id]`), the auth callback and the API routes |
| `components/` | Mascot, home screen, chat screen and cards (choices, article, images, approval) |
| `lib/agent/` | Tool loop, tools, system prompts, approve/decline and image pick |
| `lib/ai/` | DeepSeek client, writing briefs (ported from the admin plugin), image generation |
| `lib/wp/client.ts` | REST client for the user's subsite |
| `wordpress/haswell-bots-companion/` | The WordPress plugin (network-activate it) |
| `deploy/` | systemd unit, nginx snippet and deploy script for the HestiaCP VPS |
| `tests/` | Unit tests, including the approval gate (Vitest) |
| `e2e/` | End-to-end run against a throwaway WordPress multisite |

## Setup

### 1. WordPress (once per network)

1. Upload `wordpress/haswell-bots-companion` to `wp-content/plugins/` and
   **Network Activate** it. ACF must be active.
2. Add to `wp-config.php`:
   ```php
   define( 'HASWELL_BOTS_APP_URL', 'https://bots.example.com' );
   define( 'HASWELL_BOTS_CLIENT_SECRET', '<32+ random characters>' ); // openssl rand -hex 32
   ```
3. Make sure Application Passwords aren't disabled by a security plugin. They
   need HTTPS.
4. Add each user to their subsite with the **Editor** role.

If a site's settings posts can't be detected, pin them with
`HASWELL_SETTINGS_POST_PROFILE`, `_CONTACT` and `_MEDIA`, the same constants
the admin app uses.

### 2. The app

```bash
cp .env.example .env.local   # fill in
npm install
npm run dev                  # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `APP_URL` | This app's public URL. Must match `HASWELL_BOTS_APP_URL`. |
| `WP_NETWORK_URL` | The network's main site |
| `HASWELL_BOTS_CLIENT_SECRET` | Same value as in wp-config |
| `SESSION_SECRET` | 32+ random characters; encrypts the session cookie |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | Orchestration and writing (default `deepseek-v4-flash`) |
| `DEEPSEEK_WRITER_MODEL` | Optional; e.g. `deepseek-v4-pro` for the articles only |
| `OPENAI_API_KEY` or `GEMINI_API_KEY` | Featured images (OpenAI `gpt-image-1-mini`, low quality, by default) |
| `DATA_DIR` | Where image candidates wait until one is picked. Use an absolute path in production. |

### 3. Deploy to the VPS (HestiaCP)

Layout on the server (user `haswell`, app on port 3200):

```
/home/haswell/web/bots.haswell.app/
├── public_html/   empty: nginx forwards everything to the app
└── private/
    ├── .env       keys and secrets (chmod 600)
    ├── src/       git clone of this repo (main)
    ├── app/       the running build (made by deploy/update.sh)
    └── data/      image candidates
```

One-time setup:

1. **Deploy key.** Run `ssh-keygen -t ed25519 -f /root/.ssh/haswellgrokbot -N ""`
   and add the `.pub` file as a read-only deploy key on GitHub. Then add a
   `Host github-haswellgrokbot` entry to `/root/.ssh/config` that uses it.
2. **Code.** `git clone git@github-haswellgrokbot:y2gabs/HaswellGrokBot.git private/src`.
3. **Settings.** Create `private/.env` from `.env.example`, with
   `DATA_DIR=/home/haswell/web/bots.haswell.app/private/data`.
4. **Service.** Copy `deploy/haswell-bots.service` to `/etc/systemd/system/`,
   then run `systemctl enable haswell-bots`.
5. **nginx.** Make a HestiaCP proxy template from `default.tpl`/`default.stpl`
   with `proxy_pass http://127.0.0.1:3200;`, as in
   `deploy/nginx-haswell-bots.conf`. Apply it with
   `v-change-web-domain-proxy-tpl haswell bots.haswell.app haswellbots`, and turn
   on Let's Encrypt SSL and SSL force.

Every update after that (as root):

```bash
/home/haswell/web/bots.haswell.app/private/src/deploy/update.sh
```

The script does five things in order:

1. Pulls `main`.
2. Builds. If the build fails, the running app is untouched.
3. Swaps in the new build and restarts the service.
4. Checks the app answers, and rolls back to the previous build if it doesn't.
5. Installs `wordpress/haswell-bots-companion` into
   `/home/haswell/web/haswell.app/public_html/wp-content/plugins/`.

## Checks

```bash
npm run lint && npm run typecheck && npm test   # unit tests
npm run build
```

`e2e/README.md` describes the full browser run. It covers the real WordPress
sign-in, approving a tagline change, and the whole Marketing flow through
publishing, against a throwaway multisite with a scripted AI.

## Why DeepSeek V4 Flash

It's among the cheapest models with dependable OpenAI-style tool calling, and
the admin plugin already uses it for writing. Every change waits behind an
approval card that runs a validated, stored request, so a cheap model's
occasional misstep costs a declined card, not a broken site. For better
writing at a few times the cost, set `DEEPSEEK_WRITER_MODEL=deepseek-v4-pro`
(or `DEEPSEEK_MODEL` for both).
