#!/usr/bin/env bash
# Builds a throwaway WordPress multisite (SQLite + ACF + the companion plugin)
# for the end-to-end run. Usage:  WORK=/tmp/hb-e2e ./e2e/setup.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:?set WORK to a scratch directory}"
mkdir -p "$WORK" && cd "$WORK"

[ -f wp-cli.phar ] || curl -sSL -o wp-cli.phar https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
[ -d wp ] || git clone -q --depth 1 https://github.com/WordPress/WordPress.git wp
[ -d sqlite ] || git clone -q --depth 1 https://github.com/WordPress/sqlite-database-integration.git sqlite
[ -d acf ] || git clone -q --depth 1 https://github.com/AdvancedCustomFields/acf.git acf

P=wp/wp-content/plugins
rm -rf "$P/sqlite-database-integration" "$P/advanced-custom-fields" "$P/haswell-bots-companion" wp/wp-content/database wp/wp-config.php
cp -rL sqlite/packages/plugin-sqlite-database-integration "$P/sqlite-database-integration"
sed -e "s#{SQLITE_IMPLEMENTATION_FOLDER_PATH}#$WORK/$P/sqlite-database-integration#; s#{SQLITE_PLUGIN}#sqlite-database-integration/load.php#g" \
  sqlite/packages/plugin-sqlite-database-integration/db.copy > wp/wp-content/db.php
cp -r acf "$P/advanced-custom-fields"
cp -r "$HERE/../wordpress/haswell-bots-companion" "$P/"
mkdir -p wp/wp-content/mu-plugins && cp "$HERE/theme-stub.php" wp/wp-content/mu-plugins/

WP="php wp-cli.phar --allow-root --path=wp"
$WP config create --dbname=wp --dbuser=wp --dbpass=wp --skip-check
$WP core multisite-install --url=http://localhost --title=Network --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email
$WP config set WP_ENVIRONMENT_TYPE local
$WP config set HASWELL_BOTS_APP_URL http://localhost:3000
$WP config set HASWELL_BOTS_CLIENT_SECRET xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
$WP plugin activate advanced-custom-fields haswell-bots-companion --network
$WP site create --slug=acme --title="Acme Plumbing"
$WP site create --slug=other --title="Other Co"
U=--url=http://localhost/acme/
$WP user create editor1 ed1@example.com --role=editor --user_pass=pass1 $U
$WP user create author1 au1@example.com --role=author --user_pass=pass3 $U
P1=$($WP post create --post_type=website_settings --post_status=publish --post_title=Profile --porcelain $U)
P2=$($WP post create --post_type=website_settings --post_status=publish --post_title=Contact --porcelain $U)
$WP post create --post_type=website_settings --post_status=publish --post_title=Media --porcelain $U >/dev/null
$WP eval "update_field('company_name','Acme Plumbing',$P1); update_field('long_tagline','Old long tagline',$P1); update_field('company_phone_number','555-0100',$P2);" $U
echo "Profile settings post: $P1"
echo "Ready. Serve with:  WP_ROOT=$WORK/wp php -S localhost:80 $HERE/router.php"
