<?php
/**
 * The website_settings post type, for the Website Manager bot.
 *
 *   GET  haswell-bots/v1/website-settings
 *        { profile: { postId, title, fields: { company_name: { label, type, value… } } },
 *          contact: {…}, media: {…} }
 *   POST haswell-bots/v1/website-settings  { section, fields: { long_tagline: "…" } }
 *
 * A subsite has three website_settings posts — Company Profile, Company
 * Contact and Website Media — whose IDs differ per site. They are found the
 * same way the Haswell Admin App finds them: by a signature ACF field that
 * holds a value, or pinned in wp-config.php:
 *
 *   define( 'HASWELL_SETTINGS_POST_PROFILE', 162 );
 *   define( 'HASWELL_SETTINGS_POST_CONTACT', 161 );
 *   define( 'HASWELL_SETTINGS_POST_MEDIA',   163 );
 *
 * When the Haswell Admin App plugin is active its resolver is used, so both
 * always agree on which post is which.
 *
 * Saving fires acf/save_post on the settings post, which is what copies the
 * values onto every published page (the theme's / admin plugin's fan-out).
 *
 * @package HaswellBots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * website_settings route.
 */
class Haswell_Bots_Settings {

	const POST_TYPE = 'website_settings';

	/**
	 * Section => signature field.
	 */
	const SECTIONS = array(
		'profile' => 'company_name',
		'contact' => 'company_phone_number',
		'media'   => 'website_header_image',
	);

	/**
	 * Section => wp-config pin.
	 */
	const PINS = array(
		'profile' => 'HASWELL_SETTINGS_POST_PROFILE',
		'contact' => 'HASWELL_SETTINGS_POST_CONTACT',
		'media'   => 'HASWELL_SETTINGS_POST_MEDIA',
	);

	/**
	 * Singleton.
	 *
	 * @var Haswell_Bots_Settings|null
	 */
	private static $instance = null;

	/**
	 * Boot.
	 *
	 * @return Haswell_Bots_Settings
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
	 * Section keys with labels, for the schema route.
	 *
	 * @return array
	 */
	public static function section_labels() {
		return array(
			'profile' => 'Company Profile',
			'contact' => 'Company Contact',
			'media'   => 'Website Media',
		);
	}

	/**
	 * Section => post id.
	 *
	 * @return int[]
	 */
	public static function resolve() {
		if ( class_exists( 'Haswell_Admin_Settings_Posts' ) && method_exists( 'Haswell_Admin_Settings_Posts', 'resolve' ) ) {
			$map = Haswell_Admin_Settings_Posts::resolve();
			if ( is_array( $map ) && $map ) {
				return array_map( 'intval', $map );
			}
		}

		$map   = array();
		$taken = array();

		foreach ( self::PINS as $section => $constant ) {
			if ( defined( $constant ) && 'website_settings' === get_post_type( (int) constant( $constant ) ) ) {
				$map[ $section ] = (int) constant( $constant );
				$taken[]         = $map[ $section ];
			}
		}

		$posts = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => array( 'publish', 'private', 'draft' ),
				'posts_per_page' => 20,
				'orderby'        => 'ID',
				'order'          => 'ASC',
				'fields'         => 'ids',
				'no_found_rows'  => true,
			)
		);

		foreach ( self::SECTIONS as $section => $signature ) {
			if ( isset( $map[ $section ] ) ) {
				continue;
			}
			foreach ( $posts as $post_id ) {
				if ( in_array( (int) $post_id, $taken, true ) || ! function_exists( 'get_field' ) ) {
					continue;
				}
				$value = get_field( $signature, $post_id, false );
				if ( null !== $value && '' !== $value && false !== $value && array() !== $value ) {
					$map[ $section ] = (int) $post_id;
					$taken[]         = (int) $post_id;
					break;
				}
			}
		}

		/**
		 * Filter which website_settings post backs each section.
		 *
		 * @param int[] $map Section => post id.
		 */
		return (array) apply_filters( 'haswell_bots_settings_posts', $map );
	}

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'haswell-bots/v1',
			'/website-settings',
			array(
				array(
					'methods'             => 'GET',
					'permission_callback' => 'haswell_bots_can_use',
					'callback'            => array( $this, 'get_settings' ),
				),
				array(
					'methods'             => 'POST',
					'permission_callback' => 'haswell_bots_can_use',
					'callback'            => array( $this, 'update_settings' ),
				),
			)
		);
	}

	/**
	 * One section's payload.
	 *
	 * @param int $post_id Settings post.
	 * @return array
	 */
	private function section_payload( $post_id ) {
		return array(
			'postId' => (int) $post_id,
			'title'  => get_the_title( $post_id ),
			'fields' => Haswell_Bots_Fields::snapshot( $post_id, Haswell_Bots_Fields::definitions( $post_id ) ),
		);
	}

	/**
	 * GET website-settings.
	 *
	 * @return WP_REST_Response
	 */
	public function get_settings() {
		$map = self::resolve();
		$out = array();
		foreach ( array_keys( self::SECTIONS ) as $section ) {
			$out[ $section ] = isset( $map[ $section ] ) ? $this->section_payload( $map[ $section ] ) : null;
		}
		return rest_ensure_response( $out );
	}

	/**
	 * POST website-settings.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_settings( WP_REST_Request $request ) {
		$section = (string) $request->get_param( 'section' );
		$map     = self::resolve();
		if ( ! isset( self::SECTIONS[ $section ] ) ) {
			return new WP_Error( 'haswell_bots_bad_section', 'section must be one of: ' . implode( ', ', array_keys( self::SECTIONS ) ) . '.', array( 'status' => 400 ) );
		}
		if ( ! isset( $map[ $section ] ) ) {
			return new WP_Error( 'haswell_bots_no_section', 'This site has no ' . self::section_labels()[ $section ] . ' settings post.', array( 'status' => 404 ) );
		}

		$post_id = $map[ $section ];
		$defs    = Haswell_Bots_Fields::definitions( $post_id );
		$clean   = Haswell_Bots_Fields::clean_all( $request->get_param( 'fields' ), $defs );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		if ( ! $clean ) {
			return new WP_Error( 'haswell_bots_no_fields', 'No fields to change.', array( 'status' => 400 ) );
		}

		if ( $request->get_param( 'dryRun' ) ) {
			return rest_ensure_response(
				array(
					'dryRun'  => true,
					'section' => $section,
					'clean'   => $clean,
				)
			);
		}

		Haswell_Bots_Fields::write( $post_id, $clean, $defs );

		return rest_ensure_response(
			array(
				'section' => $section,
				'changed' => array_keys( $clean ),
			) + $this->section_payload( $post_id )
		);
	}
}
