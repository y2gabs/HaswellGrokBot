<?php
/**
 * In-app sign-in: the bots app's own login screen, so the user never leaves it.
 *
 *   POST haswell-bots/v1/login       { client_secret, username, password, client_ip? }
 *        → the credential for the user's one site, or
 *          { needsSite: true, ticket, sites: [ { id, name, url } ] }
 *   POST haswell-bots/v1/login/site  { client_secret, ticket, site }
 *        → the credential for the chosen site
 *
 * The password is checked with WordPress's own wp_authenticate() (username or
 * email), used once and never stored. Only a caller holding the client secret
 * (the app's server) can use these routes.
 *
 * Failed attempts are rate limited per username and per visitor IP (the app
 * passes the visitor's address; every request reaches WordPress from the
 * app's server, so the request's own IP would lock everyone out at once).
 * The error never says whether the username exists.
 *
 * WordPress's own login page (the connect flow in class-connect.php) still
 * works, for sites that need two-factor or social login there.
 *
 * @package HaswellBots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Login routes.
 */
class Haswell_Bots_Login {

	const MAX_USER_FAILS = 5;
	const MAX_IP_FAILS   = 20;
	const WINDOW         = 900;
	const TICKET_TTL     = 300;
	const TICKET_PREFIX  = 'hb_login_t_';

	/**
	 * Singleton.
	 *
	 * @var Haswell_Bots_Login|null
	 */
	private static $instance = null;

	/**
	 * Boot.
	 *
	 * @return Haswell_Bots_Login
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Hooks.
	 */
	private function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'haswell-bots/v1',
			'/login',
			array(
				'methods'             => 'POST',
				// Authenticated by the client secret, checked in the callback.
				'permission_callback' => '__return_true',
				'callback'            => array( $this, 'login' ),
			)
		);
		register_rest_route(
			'haswell-bots/v1',
			'/login/site',
			array(
				'methods'             => 'POST',
				'permission_callback' => '__return_true',
				'callback'            => array( $this, 'choose_site' ),
			)
		);
	}

	/**
	 * Reject callers without the client secret.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_Error|null
	 */
	private function check_client( WP_REST_Request $request ) {
		if ( ! Haswell_Bots_Connect::is_configured() ) {
			return new WP_Error( 'haswell_bots_unconfigured', 'Sign-in is not set up on this network yet.', array( 'status' => 503 ) );
		}
		if ( ! Haswell_Bots_Connect::client_ok( $request->get_param( 'client_secret' ) ) ) {
			return new WP_Error( 'haswell_bots_bad_client', 'Unknown client.', array( 'status' => 401 ) );
		}
		return null;
	}

	/**
	 * Rate-limit counter keys for this attempt.
	 *
	 * @param string          $username Username or email as typed.
	 * @param WP_REST_Request $request  Request.
	 * @return array { user, ip }
	 */
	private function limit_keys( $username, WP_REST_Request $request ) {
		$ip = (string) $request->get_param( 'client_ip' );
		if ( ! filter_var( $ip, FILTER_VALIDATE_IP ) ) {
			$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		}
		return array(
			'user' => 'hb_login_u_' . md5( strtolower( trim( $username ) ) ),
			'ip'   => 'hb_login_ip_' . md5( $ip ),
		);
	}

	/**
	 * Whether this username or visitor has failed too often recently.
	 *
	 * @param array $keys From limit_keys().
	 * @return bool
	 */
	private function locked( $keys ) {
		return (int) get_site_transient( $keys['user'] ) >= self::MAX_USER_FAILS
			|| (int) get_site_transient( $keys['ip'] ) >= self::MAX_IP_FAILS;
	}

	/**
	 * Count a failed attempt.
	 *
	 * @param array $keys From limit_keys().
	 * @return void
	 */
	private function record_failure( $keys ) {
		foreach ( $keys as $key ) {
			set_site_transient( $key, (int) get_site_transient( $key ) + 1, self::WINDOW );
		}
	}

	/**
	 * Sign the user in to one site: mint the credential and return it.
	 *
	 * @param WP_User $user User.
	 * @param array   $site Eligible site.
	 * @return WP_REST_Response|WP_Error
	 */
	private function sign_in( $user, $site ) {
		$minted = Haswell_Bots_Connect::mint( $user, $site );
		if ( is_wp_error( $minted ) ) {
			return new WP_Error( 'haswell_bots_mint_failed', $minted->get_error_message(), array( 'status' => 500 ) );
		}
		return rest_ensure_response( Haswell_Bots_Connect::credential( $user, (int) $site['id'], $minted ) );
	}

	/**
	 * POST login.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function login( WP_REST_Request $request ) {
		$bad = $this->check_client( $request );
		if ( $bad ) {
			return $bad;
		}

		$username = trim( (string) $request->get_param( 'username' ) );
		$password = (string) $request->get_param( 'password' );
		if ( '' === $username || '' === $password ) {
			return new WP_Error( 'haswell_bots_missing', 'Enter your username or email and your password.', array( 'status' => 400 ) );
		}

		$keys = $this->limit_keys( $username, $request );
		if ( $this->locked( $keys ) ) {
			return new WP_Error( 'haswell_bots_locked', 'Too many sign-in attempts. Please wait 15 minutes and try again.', array( 'status' => 429 ) );
		}

		// A real password only: an Application Password is not a way in here.
		add_filter( 'application_password_is_api_request', '__return_false', 99 );
		$user = wp_authenticate( $username, $password );
		remove_filter( 'application_password_is_api_request', '__return_false', 99 );

		if ( is_wp_error( $user ) ) {
			$this->record_failure( $keys );
			// Same answer whether or not the account exists.
			return new WP_Error( 'haswell_bots_bad_login', 'Incorrect username or password.', array( 'status' => 401 ) );
		}
		delete_site_transient( $keys['user'] );

		if ( ! wp_is_application_passwords_available_for_user( $user ) ) {
			return new WP_Error( 'haswell_bots_no_app_passwords', 'App sign-in is switched off for your account. Ask your administrator to enable Application Passwords.', array( 'status' => 403 ) );
		}

		$sites = Haswell_Bots_Connect::eligible_sites( $user->ID );
		if ( ! $sites ) {
			return new WP_Error( 'haswell_bots_no_sites', "Your account isn't an editor on any website yet. Ask your administrator to add you.", array( 'status' => 403 ) );
		}
		if ( 1 === count( $sites ) ) {
			return $this->sign_in( $user, $sites[0] );
		}

		$ticket = wp_generate_password( 48, false, false );
		set_site_transient( self::TICKET_PREFIX . hash( 'sha256', $ticket ), (int) $user->ID, self::TICKET_TTL );

		return rest_ensure_response(
			array(
				'needsSite' => true,
				'ticket'    => $ticket,
				'sites'     => $sites,
			)
		);
	}

	/**
	 * POST login/site — finish signing in once the user has picked a site.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function choose_site( WP_REST_Request $request ) {
		$bad = $this->check_client( $request );
		if ( $bad ) {
			return $bad;
		}

		$key     = self::TICKET_PREFIX . hash( 'sha256', (string) $request->get_param( 'ticket' ) );
		$user_id = (int) get_site_transient( $key );
		delete_site_transient( $key );
		$user = $user_id ? get_userdata( $user_id ) : false;
		if ( ! $user ) {
			return new WP_Error( 'haswell_bots_ticket_expired', 'That took too long. Please sign in again.', array( 'status' => 400 ) );
		}

		$blog_id = (int) $request->get_param( 'site' );
		foreach ( Haswell_Bots_Connect::eligible_sites( $user->ID ) as $site ) {
			if ( (int) $site['id'] === $blog_id ) {
				return $this->sign_in( $user, $site );
			}
		}
		return new WP_Error( 'haswell_bots_bad_site', "You can't manage that website. Please sign in again.", array( 'status' => 403 ) );
	}
}
