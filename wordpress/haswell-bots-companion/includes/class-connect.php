<?php
/**
 * "Sign in with your Haswell site" for the standalone Haswell Bots web app.
 *
 * The app never sees a WordPress password. Instead:
 *
 *   1. The app sends the user to the network's main site:
 *        https://<network>/?haswell_bots_connect=1&state=<random>
 *   2. This page requires a normal WordPress login, then lists the subsites
 *      the user can edit (Editor or above) and asks them to connect one.
 *   3. On "Connect", it mints an Application Password for the user, holds it
 *      server-side for two minutes under a random single-use code, and
 *      redirects to HASWELL_BOTS_APP_URL/auth/callback?code=…&state=…
 *   4. The app's server exchanges the code (plus its client secret) at
 *      POST haswell-bots/v1/token for the site URL and the credential.
 *
 * The redirect target only ever comes from wp-config, so a crafted link
 * cannot send a code anywhere else. Required wp-config constants:
 *
 *   define( 'HASWELL_BOTS_APP_URL', 'https://bots.example.com' );
 *   define( 'HASWELL_BOTS_CLIENT_SECRET', '<long random string>' );
 *
 * Both features stay switched off until both are set.
 *
 * @package HaswellBots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Connect page + token exchange.
 */
class Haswell_Bots_Connect {

	const QUERY_VAR    = 'haswell_bots_connect';
	const NONCE_ACTION = 'haswell_bots_connect';
	const CODE_TTL     = 120;
	const CODE_PREFIX  = 'haswell_bots_code_';
	const APP_NAME     = 'Haswell Bots';

	/**
	 * Singleton.
	 *
	 * @var Haswell_Bots_Connect|null
	 */
	private static $instance = null;

	/**
	 * Boot.
	 *
	 * @return Haswell_Bots_Connect
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Hook registration.
	 */
	private function __construct() {
		add_action( 'template_redirect', array( $this, 'maybe_render' ), 0 );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * The app's base URL from wp-config, without a trailing slash.
	 *
	 * @return string
	 */
	public static function app_url() {
		return defined( 'HASWELL_BOTS_APP_URL' ) ? untrailingslashit( trim( (string) HASWELL_BOTS_APP_URL ) ) : '';
	}

	/**
	 * The shared secret the app presents when exchanging a code.
	 *
	 * @return string
	 */
	private static function client_secret() {
		return defined( 'HASWELL_BOTS_CLIENT_SECRET' ) ? trim( (string) HASWELL_BOTS_CLIENT_SECRET ) : '';
	}

	/**
	 * Whether sign-in is configured on this network.
	 *
	 * @return bool
	 */
	public static function is_configured() {
		return '' !== self::app_url() && strlen( self::client_secret() ) >= 32;
	}

	/**
	 * Sites the user can connect: those where they can edit posts. Editors and
	 * administrators qualify; authors and subscribers do not, because the bots
	 * edit other people's content and the site settings.
	 *
	 * @param int $user_id User id.
	 * @return array[] Each { id, name, url }.
	 */
	public static function eligible_sites( $user_id ) {
		$sites = array();
		$blogs = is_multisite() ? get_blogs_of_user( $user_id ) : array(
			(object) array(
				'userblog_id' => get_current_blog_id(),
				'blogname'    => get_bloginfo( 'name' ),
				'siteurl'     => home_url(),
			),
		);

		foreach ( $blogs as $blog ) {
			$blog_id = (int) $blog->userblog_id;
			$cap     = apply_filters( 'haswell_bots_capability', 'edit_others_posts' );
			$allowed = is_multisite()
				? user_can_for_site( $user_id, $blog_id, $cap )
				: user_can( $user_id, $cap );
			if ( ! $allowed ) {
				continue;
			}
			$sites[] = array(
				'id'   => $blog_id,
				'name' => html_entity_decode( (string) $blog->blogname, ENT_QUOTES ),
				'url'  => is_multisite() ? get_home_url( $blog_id ) : home_url(),
			);
		}

		/**
		 * Filter the subsites a user may connect to the bots app.
		 *
		 * @param array[] $sites   Each { id, name, url }.
		 * @param int     $user_id User id.
		 */
		return (array) apply_filters( 'haswell_bots_eligible_sites', $sites, $user_id );
	}

	/**
	 * Serve the connect page when its query var is present on the main site.
	 *
	 * @return void
	 */
	public function maybe_render() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- routing only.
		if ( ! isset( $_GET[ self::QUERY_VAR ] ) ) {
			return;
		}
		if ( is_multisite() && ! is_main_site() ) {
			return;
		}

		nocache_headers();
		header( 'X-Frame-Options: DENY' );

		if ( ! self::is_configured() ) {
			$this->page( 'Sign-in is not available', '<p>The bots app has not been set up on this network yet.</p>' );
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- validated as an opaque token.
		$state = isset( $_REQUEST['state'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['state'] ) ) : '';
		if ( ! preg_match( '/^[A-Za-z0-9_-]{16,128}$/', $state ) ) {
			$this->page( 'Sign-in link is invalid', '<p>Go back to the app and choose Sign in again.</p>' );
		}

		if ( ! is_user_logged_in() ) {
			$here = add_query_arg(
				array(
					self::QUERY_VAR => 1,
					'state'         => $state,
				),
				home_url( '/' )
			);
			wp_safe_redirect( wp_login_url( $here ) );
			exit;
		}

		$user  = wp_get_current_user();
		$sites = self::eligible_sites( $user->ID );

		if ( ! wp_is_application_passwords_available_for_user( $user ) ) {
			$this->page( 'Sign-in is not available', '<p>App sign-in is switched off for your account. Ask your administrator to enable Application Passwords.</p>' );
		}

		if ( empty( $sites ) ) {
			$this->page(
				'No sites to connect',
				sprintf(
					'<p>You are signed in as <strong>%s</strong>, but you are not an editor on any Haswell site.</p><p><a href="%s">Sign in as someone else</a></p>',
					esc_html( $user->user_login ),
					esc_url( wp_logout_url( add_query_arg( array( self::QUERY_VAR => 1, 'state' => $state ), home_url( '/' ) ) ) )
				)
			);
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified below.
		if ( 'POST' === ( isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : '' ) ) {
			$this->handle_connect( $user, $sites, $state );
		}

		$this->render_consent( $user, $sites, $state );
	}

	/**
	 * Mint the credential and send the user back to the app.
	 *
	 * @param WP_User $user  Current user.
	 * @param array[] $sites Eligible sites.
	 * @param string  $state Opaque state from the app.
	 * @return void
	 */
	private function handle_connect( $user, $sites, $state ) {
		check_admin_referer( self::NONCE_ACTION );

		$blog_id = isset( $_POST['site'] ) ? (int) $_POST['site'] : 0;
		$site    = null;
		foreach ( $sites as $candidate ) {
			if ( (int) $candidate['id'] === $blog_id ) {
				$site = $candidate;
				break;
			}
		}
		if ( ! $site ) {
			$this->page( 'Choose a site', '<p>That site is not one you can connect. Go back and pick again.</p>' );
		}

		$created = WP_Application_Passwords::create_new_application_password(
			$user->ID,
			array(
				'name' => sprintf( '%s — %s', self::APP_NAME, $site['name'] ),
			)
		);
		if ( is_wp_error( $created ) ) {
			$this->page( 'Could not connect', '<p>' . esc_html( $created->get_error_message() ) . '</p>' );
		}

		list( $password, $item ) = $created;

		$code = wp_generate_password( 48, false, false );
		set_site_transient(
			self::CODE_PREFIX . hash( 'sha256', $code ),
			array(
				'user_id'  => (int) $user->ID,
				'blog_id'  => (int) $site['id'],
				'password' => $password,
				'uuid'     => $item['uuid'],
			),
			self::CODE_TTL
		);

		$target = add_query_arg(
			array(
				'code'  => rawurlencode( $code ),
				'state' => rawurlencode( $state ),
			),
			self::app_url() . '/auth/callback'
		);

		// wp_redirect, not wp_safe_redirect: the host is the app's, and it comes
		// only from wp-config, never from the request.
		wp_redirect( $target ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect
		exit;
	}

	/**
	 * The consent screen: which site, and a Connect button.
	 *
	 * @param WP_User $user  Current user.
	 * @param array[] $sites Eligible sites.
	 * @param string  $state Opaque state.
	 * @return void
	 */
	private function render_consent( $user, $sites, $state ) {
		$options = '';
		foreach ( $sites as $index => $site ) {
			$options .= sprintf(
				'<label class="site"><input type="radio" name="site" value="%d"%s> <span><strong>%s</strong><small>%s</small></span></label>',
				(int) $site['id'],
				0 === $index ? ' checked' : '',
				esc_html( $site['name'] ),
				esc_html( preg_replace( '#^https?://#', '', $site['url'] ) )
			);
		}

		$body = sprintf(
			'<p>Haswell Bots wants to manage your website as <strong>%1$s</strong>. It can edit your website settings, services, team, partners and announcements — and it always asks before changing anything.</p>
			<form method="post">%2$s
				<input type="hidden" name="state" value="%3$s">
				<fieldset>%4$s</fieldset>
				<button type="submit">Connect</button>
			</form>
			<p class="muted">Not you? <a href="%5$s">Sign in as someone else</a></p>',
			esc_html( $user->display_name ? $user->display_name : $user->user_login ),
			wp_nonce_field( self::NONCE_ACTION, '_wpnonce', true, false ),
			esc_attr( $state ),
			$options,
			esc_url( wp_logout_url( add_query_arg( array( self::QUERY_VAR => 1, 'state' => $state ), home_url( '/' ) ) ) )
		);

		$this->page( 'Connect your website', $body );
	}

	/**
	 * Print a minimal standalone page and stop.
	 *
	 * @param string $title Heading.
	 * @param string $body  Trusted, already-escaped HTML.
	 * @return void
	 */
	private function page( $title, $body ) {
		status_header( 200 );
		header( 'Content-Type: text/html; charset=utf-8' );
		?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><?php echo esc_html( $title ); ?></title>
<style>
	:root { color-scheme: dark; }
	body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b0c; color: #f4f4f5; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }
	main { width: min(420px, calc(100% - 32px)); background: #18181b; border: 1px solid #27272a; border-radius: 24px; padding: 28px; }
	h1 { font-size: 22px; margin: 0 0 12px; }
	p { color: #d4d4d8; }
	.muted { color: #a1a1aa; font-size: 14px; }
	a { color: #f4f4f5; }
	fieldset { border: 0; padding: 0; margin: 16px 0; display: grid; gap: 8px; }
	.site { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border: 1px solid #3f3f46; border-radius: 14px; cursor: pointer; }
	.site span { display: grid; }
	.site small { color: #a1a1aa; }
	button { width: 100%; padding: 14px; border: 0; border-radius: 999px; background: #f4f4f5; color: #0b0b0c; font-weight: 600; font-size: 16px; cursor: pointer; }
</style>
</head>
<body><main><h1><?php echo esc_html( $title ); ?></h1><?php echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped by callers. ?></main></body>
</html>
		<?php
		exit;
	}

	/**
	 * Register the token exchange route.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'haswell-bots/v1',
			'/token',
			array(
				'methods'             => 'POST',
				// Authenticated by the client secret + single-use code, not a cookie.
				'permission_callback' => '__return_true',
				'callback'            => array( $this, 'exchange_code' ),
				'args'                => array(
					'code'          => array(
						'type'     => 'string',
						'required' => true,
					),
					'client_secret' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
	}

	/**
	 * POST haswell-bots/v1/token — swap a single-use code for the credential.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function exchange_code( WP_REST_Request $request ) {
		if ( ! self::is_configured() ) {
			return new WP_Error( 'haswell_bots_unconfigured', 'Sign-in is not configured.', array( 'status' => 503 ) );
		}
		if ( ! hash_equals( self::client_secret(), (string) $request->get_param( 'client_secret' ) ) ) {
			return new WP_Error( 'haswell_bots_bad_client', 'Unknown client.', array( 'status' => 401 ) );
		}

		$key  = self::CODE_PREFIX . hash( 'sha256', (string) $request->get_param( 'code' ) );
		$data = get_site_transient( $key );
		// Single use, whatever happens next.
		delete_site_transient( $key );

		if ( ! is_array( $data ) ) {
			return new WP_Error( 'haswell_bots_bad_code', 'This sign-in has expired. Please sign in again.', array( 'status' => 400 ) );
		}

		$user = get_userdata( $data['user_id'] );
		if ( ! $user ) {
			return new WP_Error( 'haswell_bots_bad_code', 'This sign-in has expired. Please sign in again.', array( 'status' => 400 ) );
		}

		$blog_id = (int) $data['blog_id'];
		$role    = '';
		if ( is_multisite() ) {
			switch_to_blog( $blog_id );
		}
		$site_user = new WP_User( $user->ID );
		$roles     = (array) $site_user->roles;
		$role      = $roles ? reset( $roles ) : '';
		$site      = array(
			'id'      => $blog_id,
			'name'    => html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES ),
			'url'     => home_url(),
			'restUrl' => get_rest_url(),
		);
		if ( is_multisite() ) {
			restore_current_blog();
		}

		return rest_ensure_response(
			array(
				'site'        => $site,
				'user'        => array(
					'id'          => (int) $user->ID,
					'username'    => $user->user_login,
					'displayName' => $user->display_name,
					'email'       => $user->user_email,
					'role'        => $role,
				),
				'appPassword' => array(
					'password' => $data['password'],
					'uuid'     => $data['uuid'],
				),
			)
		);
	}
}
