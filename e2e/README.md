# End-to-end run

This drives the real sign-in and both bots in Chromium. It runs against a
throwaway WordPress multisite (SQLite, ACF, a stub of the theme's post types and
the companion plugin), with `mock-ai.mjs` standing in for DeepSeek and OpenAI.

```bash
export WORK=/tmp/hb-e2e NO_PROXY=localhost
./e2e/setup.sh
WP_ROOT=$WORK/wp php -S localhost:80 e2e/router.php &      # WordPress
node e2e/mock-ai.mjs &                                    # scripted AI on :4010
npm run build && env $(cat e2e/app.env | xargs) DATA_DIR=$WORK/data npx next start -p 3000 &
SHOTS=$WORK node e2e/run.mjs
```

The run checks each of these:

- Sign-in goes through WordPress and lands on the home screen.
- Nothing is written before the user taps Approve.
- The long tagline really changes after approval.
- The Marketing flow (three ideas → article → image pick → approve) creates a
  published announcement with its featured image.
- Signing out revokes the Application Password.

Screenshots go in `$SHOTS`.
