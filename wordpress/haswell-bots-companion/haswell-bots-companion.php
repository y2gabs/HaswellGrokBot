<?php
/**
 * Plugin Name:       Haswell Bots Companion
 * Plugin URI:        https://github.com/y2gabs/HaswellGrokBot
 * Description:       WordPress side of the Haswell Bots web app: "Connect your website" sign-in, private chat history, and the REST routes the bots use to edit website_settings, services, team members, partners and announcements.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Network:           true
 * Author:            Haswell
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       haswell-bots
 *
 * @package HaswellBots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'HASWELL_BOTS_VERSION', '0.1.0' );
define( 'HASWELL_BOTS_DIR', plugin_dir_path( __FILE__ ) );

require_once HASWELL_BOTS_DIR . 'includes/class-fields.php';
require_once HASWELL_BOTS_DIR . 'includes/class-settings.php';
require_once HASWELL_BOTS_DIR . 'includes/class-content.php';
require_once HASWELL_BOTS_DIR . 'includes/class-schema.php';
require_once HASWELL_BOTS_DIR . 'includes/class-threads.php';
require_once HASWELL_BOTS_DIR . 'includes/class-connect.php';

/**
 * Permission shared by every bots route: Editors and up on this subsite.
 *
 * The bots edit other people's content (a team member someone else added) and
 * the website_settings posts, so Author is not enough.
 *
 * @return bool
 */
function haswell_bots_can_use() {
	/**
	 * Filter the capability the bots require on a subsite.
	 *
	 * @param string $cap Default edit_others_posts (Editor and up).
	 */
	return current_user_can( apply_filters( 'haswell_bots_capability', 'edit_others_posts' ) );
}

add_action(
	'plugins_loaded',
	function () {
		Haswell_Bots_Settings::instance();
		Haswell_Bots_Content::instance();
		Haswell_Bots_Schema::instance();
		Haswell_Bots_Threads::instance();
		Haswell_Bots_Connect::instance();
	}
);
