# WordPress chat assistants

A mobile-first web app that gives site owners on a WordPress multisite network a
small team of AI chat assistants for their own site, grouped into Website,
Marketing, Operations and Customers. Each assistant does its work
conversationally and **always asks before changing anything**.

- **Article Author** (Marketing) suggests a few post ideas and writes the one you pick. It then
  offers featured-image options and, once you approve, publishes the post.
- **Website Manager** (Website) updates site settings and adds, changes or
  removes content items (for example services, team members and partners) through
  conversation. You can attach photos in the chat for image fields.

You can type or dictate. The mic button uses the browser's built-in speech
recognition (Chrome, Edge, Safari/iOS; hidden where unsupported). Dictation
only fills the message box, so you still review it and tap Send.

```
Browser ─► Next.js app (this repo)
             ├─ LLM (DeepSeek by default): orchestration and writing
             ├─ Image model (OpenAI or Gemini): featured images
             └─ the user's subsite REST API, as that user
                  └─ companion WordPress plugin (wordpress/, this repo)
```

## How it works

**Sign-in.** Users sign in on the app's own screen with their WordPress
username (or email) and password. The app's server passes these to the
companion plugin, which checks them with WordPress's own login and finds the
subsites where the user is an Editor or above. The user picks a site if there
are several. The plugin then issues an Application Password for that site.
The app keeps it only in an encrypted, httpOnly cookie, and signing out
revokes it.

- The password is used once and never stored.
- Failed attempts are rate limited, and errors don't reveal whether an account
  exists.
- A fallback link uses WordPress's own login page, for sites that need
  two-factor or social login.

**Assistants.** Each turn is an LLM tool loop (`lib/agent/loop.ts`) with three
kinds of tools (`lib/agent/tools.ts`):

- **Read tools** run straight away.
- **UI tools** end the turn with a card for the user to act on, such as idea
  choices or an image picker.
- **Proposal tools never write.** Each one validates the change with the
  plugin's dry run, stores the exact request and shows an approval card with
  the before and after. Only **Approve** runs it, and it runs the stored
  request, not anything the model says afterwards.

**History.** Conversations are stored as private posts on the user's own
subsite, so the app needs no database. Turns run on the server and are saved
after every step, so closing the app mid-task doesn't lose the result.

## Repository layout

| Path | What |
| --- | --- |
| `app/` | Pages and API routes |
| `components/` | UI: home screen, chat screen, sign-in and cards |
| `lib/agent/` | Tool loop, tools, system prompts, approvals |
| `lib/ai/` | LLM client, writing prompts, image generation |
| `lib/wp/` | REST and sign-in clients for WordPress |
| `wordpress/` | Companion WordPress plugin (network-activate it) |
| `deploy/` | Example systemd unit, nginx snippet and update script |
| `tests/` | Unit tests (Vitest) |
| `e2e/` | End-to-end run against a throwaway WordPress multisite |

## Setup

### 1. WordPress (once per network)

1. Upload the plugin folder in `wordpress/` to `wp-content/plugins/` and
   **Network Activate** it. ACF must be active.
2. Add the app URL and a shared client secret to `wp-config.php`. The constant
   names are at the top of `wordpress/*/includes/class-connect.php`. Generate
   the secret with `openssl rand -hex 32`.
3. Make sure Application Passwords are enabled. They need HTTPS.
4. Give each user the **Editor** role on their subsite.

### 2. The app

```bash
cp .env.example .env.local   # fill in
npm install
npm run dev                  # http://localhost:3000
```

`.env.example` lists every setting: the app URL, the network URL, the shared
client secret, a session secret, and the LLM and image API keys.

### 3. Deploy

Any Node 20+ host works. The app builds as a standalone server
(`npm run build`, then `node .next/standalone/server.js`), placed behind
nginx with HTTPS.

`deploy/` has an example systemd unit, an nginx snippet and `update.sh`. The
script pulls the latest code, builds, swaps in the new build, restarts the
service, checks it answers (rolling back if not) and installs the plugin.
Adjust the paths at the top of `update.sh` for your server; they can also be
set as environment variables.

Keep secrets out of the repo. They belong in `.env` on the server and in
`wp-config.php`.

## Checks

```bash
npm run lint && npm run typecheck && npm test
npm run build
```

`e2e/README.md` describes the browser test. It runs against a throwaway
multisite with a scripted AI.
