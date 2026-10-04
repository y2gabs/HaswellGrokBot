<?php
/**
 * GET haswell-bots/v1/schema — everything the bots may edit on this subsite,
 * read live from ACF, so the app's tool descriptions use the real field
 * names and labels.
 *
 *   { site: { name, url },
 *     types: { services: { singular, plural, titleField, fields: [ { name, label, type, writable, required? } ] }, … },
 *     settings: { profile: { label, fields: [ … ] }, contact: …, media: … } }
 *
 * @package HaswellBots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Schema route.
 */
class Haswell_Bots_Schema {

	/**
	 * Singleton.
	 *
	 * @var Haswell_Bots_Schema|null
	 */
	private static $instance = null;

	/**
	 * Boot.
	 *
	 * @return Haswell_Bots_Schema
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
	 * Register route.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'haswell-bots/v1',
			'/schema',
			array(
				'methods'             => 'GET',
				'permission_callback' => 'haswell_bots_can_use',
				'callback'            => array( $this, 'get_schema' ),
			)
		);
	}

	/**
	 * Describe a list of definitions, minus hidden names.
	 *
	 * @param array[]  $defs   Field definitions keyed by name.
	 * @param string[] $hidden Names to leave out.
	 * @return array[]
	 */
	private function describe_all( $defs, $hidden = array() ) {
		$out = array();
		foreach ( $defs as $name => $field ) {
			if ( ! in_array( $name, $hidden, true ) ) {
				$out[] = Haswell_Bots_Fields::describe( $field );
			}
		}
		return $out;
	}

	/**
	 * GET schema.
	 *
	 * @return WP_REST_Response
	 */
	public function get_schema() {
		$types = array();
		foreach ( Haswell_Bots_Content::types() as $key => $type ) {
			if ( ! post_type_exists( $type['postType'] ) ) {
				continue;
			}
			$types[ $key ] = array(
				'singular'   => $type['singular'],
				'plural'     => $type['plural'],
				'titleField' => $type['titleField'],
				'imageField' => in_array( $type['imageField'], $type['hidden'], true ) ? null : $type['imageField'],
				'fields'     => $this->describe_all( Haswell_Bots_Fields::definitions( null, $type['postType'] ), $type['hidden'] ),
			);
		}

		$settings = array();
		$map      = Haswell_Bots_Settings::resolve();
		foreach ( Haswell_Bots_Settings::section_labels() as $section => $label ) {
			$settings[ $section ] = array(
				'label'  => $label,
				'fields' => isset( $map[ $section ] ) ? $this->describe_all( Haswell_Bots_Fields::definitions( $map[ $section ] ) ) : array(),
			);
		}

		return rest_ensure_response(
			array(
				'site'      => array(
					'name' => html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES ),
					'url'  => home_url(),
				),
				'acfActive' => function_exists( 'acf_get_field_groups' ),
				'types'     => $types,
				'settings'  => $settings,
			)
		);
	}
}
