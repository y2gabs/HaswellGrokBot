=== Haswell Bots Companion ===
Requires at least: 6.4
Requires PHP: 7.4
Stable tag: 0.2.0
License: GPL-2.0-or-later

The WordPress side of the Haswell Bots web app.

== Description ==

* In-app sign-in: POST haswell-bots/v1/login checks a WordPress username (or
  email) and password with wp_authenticate() and returns an Application
  Password for the user's Editor subsite. If they edit several, it returns the
  list plus a single-use ticket for POST haswell-bots/v1/login/site. Only
  callers with the client secret can use it. Failed attempts are rate limited
  per username (5) and per visitor IP (20) for 15 minutes.
* "Connect your website" sign-in on the network's main site
  (/?haswell_bots_connect=1). After a normal WordPress login it lists the
  subsites where the user is an Editor or above and mints an Application
  Password for the app. The password is handed over server to server through
  a single-use code at POST haswell-bots/v1/token. It never appears in a URL.
* haswell-bots/v1/website-settings: read and change the ACF fields on the
  website_settings posts (Company Profile, Company Contact, Website Media).
* haswell-bots/v1/content/<services|team|partners|announcements>: list,
  create, update and trash items, with ACF fields validated against the real
  field groups. Create and update accept dryRun.
* haswell-bots/v1/threads: private, per-user chat history.
* haswell-bots/v1/schema: the types and fields the bots may edit.

All routes require edit_others_posts (Editor and up) on the subsite. Change it
with the haswell_bots_capability filter.

== Installation ==

1. Upload haswell-bots-companion to wp-content/plugins and Network Activate it.
   ACF must be active.
2. In wp-config.php:
   define( 'HASWELL_BOTS_APP_URL', 'https://bots.example.com' );
   define( 'HASWELL_BOTS_CLIENT_SECRET', '<32+ random characters>' );
3. Application Passwords must be available. They are on by default over HTTPS.
4. Add each user to their subsite with the Editor role.

Optional pins, if a site's settings posts can't be detected:
   define( 'HASWELL_SETTINGS_POST_PROFILE', 162 );
   define( 'HASWELL_SETTINGS_POST_CONTACT', 161 );
   define( 'HASWELL_SETTINGS_POST_MEDIA',   163 );

Filters: haswell_bots_capability, haswell_bots_eligible_sites,
haswell_bots_types, haswell_bots_settings_posts.

== Changelog ==

= 0.2.0 =
* In-app sign-in (haswell-bots/v1/login and login/site) with rate limiting.

= 0.1.0 =
* First release.
