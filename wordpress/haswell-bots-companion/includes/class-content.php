<?php
/**
 * Services, team members, partners and announcements, for the bots.
 *
 *   GET    haswell-bots/v1/content/<type>[?search=]   list (newest first)
 *   GET    haswell-bots/v1/content/<type>/<id>        one item with field details
 *   POST   haswell-bots/v1/content/<type>             create { fields, status? }
 *   POST   haswell-bots/v1/content/<type>/<id>        update { fields }
 *
 * Create and update accept dryRun: true, which validates and returns the
 * cleaned values without writing — the app uses it before showing an
 * approval card, so a bad field name is caught before the user is asked.
 *   DELETE haswell-bots/v1/content/<type>/<id>        move to the trash
 *
 * <type> is one of: services, team, partners, announcements.
 *
 * Values are ACF fields, validated against the post type's real field groups
 * (see Haswell_Bots_Fields). The post title follows the type's name field and
 * the featured image follows its main image field, as the theme and the admin
 * app do; acf/save_post is fired after every write so their own save-time
 * logic (excerpts, slugs…) runs too. Deleting moves to the trash, so a
 * mistake can be undone from wp-admin.
 *
 * @package HaswellBots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Content routes.
 */
class Haswell_Bots_Content {

	/**
	 * Singleton.
	 *
	 * @var Haswell_Bots_Content|null
	 */
	private static $instance = null;

	/**
	 * Boot.
	 *
	 * @return Haswell_Bots_Content
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
	 * The content types the bots manage.
	 *
	 * @return array[] key => { postType, singular, plural, titleField, imageField, hidden[] }
	 */
	public static function types() {
		$types = array(
			'services'      => array(
				'postType'   => 'services',
				'singular'   => 'Service',
				'plural'     => 'Services',
				'titleField' => 'service_name',
				'imageField' => 'service_main_image',
				'hidden'     => array(),
			),
			'team'          => array(
				'postType'   => 'team_members',
				'singular'   => 'Team member',
				'plural'     => 'Team members',
				'titleField' => 'member_full_name',
				'imageField' => 'member_photo',
				'hidden'     => array(),
			),
			'partners'      => array(
				'postType'   => 'partners',
				'singular'   => 'Partner',
				'plural'     => 'Partners',
				'titleField' => 'partner_name',
				'imageField' => 'partner_logo',
				// Matches the admin app: the logo is managed in the back end.
				'hidden'     => array( 'partner_logo' ),
			),
			'announcements' => array(
				'postType'   => 'announcements',
				'singular'   => 'Announcement',
				'plural'     => 'Announcements',
				'titleField' => 'announcement_subject',
				'imageField' => 'announcement_featured_image',
				'hidden'     => array(),
			),
		);

		/**
		 * Filter the content types the bots manage.
		 *
		 * @param array[] $types Type definitions.
		 */
		return (array) apply_filters( 'haswell_bots_types', $types );
	}

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$type = '(?P<type>[a-z_-]+)';

		register_rest_route(
			'haswell-bots/v1',
			"/content/{$type}",
			array(
				array(
					'methods'             => 'GET',
					'permission_callback' => 'haswell_bots_can_use',
					'callback'            => array( $this, 'list_items' ),
				),
				array(
					'methods'             => 'POST',
					'permission_callback' => 'haswell_bots_can_use',
					'callback'            => array( $this, 'create_item' ),
				),
			)
		);

		register_rest_route(
			'haswell-bots/v1',
			"/content/{$type}/(?P<id>\\d+)",
			array(
				array(
					'methods'             => 'GET',
					'permission_callback' => 'haswell_bots_can_use',
					'callback'            => array( $this, 'get_item' ),
				),
				array(
					'methods'             => 'POST, PUT, PATCH',
					'permission_callback' => 'haswell_bots_can_use',
					'callback'            => array( $this, 'update_item' ),
				),
				array(
					'methods'             => 'DELETE',
					'permission_callback' => 'haswell_bots_can_use',
					'callback'            => array( $this, 'delete_item' ),
				),
			)
		);
	}

	/**
	 * Resolve a type key.
	 *
	 * @param string $key Type key.
	 * @return array|WP_Error
	 */
	private function type( $key ) {
		$types = self::types();
		if ( ! isset( $types[ $key ] ) ) {
			return new WP_Error( 'haswell_bots_bad_type', 'type must be one of: ' . implode( ', ', array_keys( $types ) ) . '.', array( 'status' => 404 ) );
		}
		if ( ! post_type_exists( $types[ $key ]['postType'] ) ) {
			return new WP_Error( 'haswell_bots_no_type', "This site doesn't have {$types[ $key ]['plural']}.", array( 'status' => 404 ) );
		}
		return $types[ $key ];
	}

	/**
	 * Load an item of the given type.
	 *
	 * @param array $type Type def.
	 * @param int   $id   Post id.
	 * @return WP_Post|WP_Error
	 */
	private function item( $type, $id ) {
		$post = get_post( (int) $id );
		if ( ! $post || $type['postType'] !== $post->post_type || 'trash' === $post->post_status ) {
			return new WP_Error( 'haswell_bots_not_found', "{$type['singular']} #{$id} was not found.", array( 'status' => 404 ) );
		}
		return $post;
	}

	/**
	 * Item payload. `details` adds labels/types per field; the list omits them
	 * to stay small.
	 *
	 * @param array   $type    Type def.
	 * @param WP_Post $post    Post.
	 * @param bool    $details Include field descriptions.
	 * @return array
	 */
	private function payload( $type, $post, $details = false ) {
		$defs     = Haswell_Bots_Fields::definitions( $post->ID );
		$snapshot = Haswell_Bots_Fields::snapshot( $post->ID, $defs, $type['hidden'] );
		$fields   = array();
		foreach ( $snapshot as $name => $entry ) {
			$fields[ $name ] = $details ? $entry : $entry['value'];
		}
		return array(
			'id'     => (int) $post->ID,
			'title'  => html_entity_decode( get_the_title( $post ), ENT_QUOTES ),
			'status' => $post->post_status,
			'link'   => get_permalink( $post ),
			'date'   => mysql_to_rfc3339( $post->post_date_gmt ),
			'fields' => $fields,
		);
	}

	/**
	 * GET content/<type>.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function list_items( WP_REST_Request $request ) {
		$type = $this->type( $request['type'] );
		if ( is_wp_error( $type ) ) {
			return $type;
		}
		$args = array(
			'post_type'      => $type['postType'],
			'post_status'    => array( 'publish', 'draft', 'pending', 'future', 'private' ),
			'posts_per_page' => 100,
			'orderby'        => 'date',
			'order'          => 'DESC',
			'no_found_rows'  => true,
		);
		$search = (string) $request->get_param( 'search' );
		if ( '' !== $search ) {
			$args['s'] = $search;
		}
		$limit = (int) $request->get_param( 'limit' );
		if ( $limit > 0 ) {
			$args['posts_per_page'] = min( 100, $limit );
		}

		$items = array();
		foreach ( get_posts( $args ) as $post ) {
			$items[] = $this->payload( $type, $post );
		}
		return rest_ensure_response( $items );
	}

	/**
	 * GET content/<type>/<id>.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( WP_REST_Request $request ) {
		$type = $this->type( $request['type'] );
		if ( is_wp_error( $type ) ) {
			return $type;
		}
		$post = $this->item( $type, $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		return rest_ensure_response( $this->payload( $type, $post, true ) );
	}

	/**
	 * Keep the post title and featured image in step with the ACF fields.
	 *
	 * @param array $type    Type def.
	 * @param int   $post_id Post id.
	 * @param array $clean   Values just written.
	 * @return void
	 */
	private function sync_post( $type, $post_id, $clean ) {
		if ( ! empty( $clean[ $type['titleField'] ] ) ) {
			wp_update_post(
				array(
					'ID'         => $post_id,
					'post_title' => $clean[ $type['titleField'] ],
				)
			);
		}
		if ( array_key_exists( $type['imageField'], $clean ) ) {
			if ( $clean[ $type['imageField'] ] ) {
				set_post_thumbnail( $post_id, (int) $clean[ $type['imageField'] ] );
			} else {
				delete_post_thumbnail( $post_id );
			}
		}
	}

	/**
	 * POST content/<type>.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( WP_REST_Request $request ) {
		$type = $this->type( $request['type'] );
		if ( is_wp_error( $type ) ) {
			return $type;
		}
		$object = get_post_type_object( $type['postType'] );
		if ( ! current_user_can( $object->cap->create_posts ) || ! current_user_can( $object->cap->publish_posts ) ) {
			return new WP_Error( 'haswell_bots_forbidden', "You can't add {$type['plural']} on this site.", array( 'status' => 403 ) );
		}

		$defs  = Haswell_Bots_Fields::definitions( null, $type['postType'] );
		$clean = Haswell_Bots_Fields::clean_all( $request->get_param( 'fields' ), $defs, $type['hidden'] );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}

		$missing = array();
		foreach ( $defs as $name => $field ) {
			if ( ! empty( $field['required'] ) && ! in_array( $name, $type['hidden'], true ) && in_array( $field['type'], Haswell_Bots_Fields::WRITABLE_TYPES, true )
				&& ( ! isset( $clean[ $name ] ) || '' === $clean[ $name ] ) ) {
				$missing[] = $field['label'] . " ({$name})";
			}
		}
		if ( $missing ) {
			return new WP_Error( 'haswell_bots_missing_fields', 'Required: ' . implode( ', ', $missing ) . '.', array( 'status' => 400 ) );
		}

		if ( $request->get_param( 'dryRun' ) ) {
			return rest_ensure_response(
				array(
					'dryRun' => true,
					'clean'  => $clean,
				)
			);
		}

		$status = 'draft' === $request->get_param( 'status' ) ? 'draft' : 'publish';
		$title  = isset( $clean[ $type['titleField'] ] ) ? $clean[ $type['titleField'] ] : '';

		$post_id = wp_insert_post(
			array(
				'post_type'   => $type['postType'],
				'post_status' => $status,
				'post_title'  => '' !== $title ? $title : $type['singular'],
				'post_author' => get_current_user_id(),
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		Haswell_Bots_Fields::write( $post_id, $clean, $defs );
		$this->sync_post( $type, $post_id, $clean );

		$response = rest_ensure_response( $this->payload( $type, get_post( $post_id ) ) );
		$response->set_status( 201 );
		return $response;
	}

	/**
	 * POST content/<type>/<id>.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( WP_REST_Request $request ) {
		$type = $this->type( $request['type'] );
		if ( is_wp_error( $type ) ) {
			return $type;
		}
		$post = $this->item( $type, $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		if ( ! current_user_can( 'edit_post', $post->ID ) ) {
			return new WP_Error( 'haswell_bots_forbidden', "You can't edit this {$type['singular']}.", array( 'status' => 403 ) );
		}

		$defs  = Haswell_Bots_Fields::definitions( $post->ID );
		$clean = Haswell_Bots_Fields::clean_all( $request->get_param( 'fields' ), $defs, $type['hidden'] );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}
		if ( ! $clean ) {
			return new WP_Error( 'haswell_bots_no_fields', 'No fields to change.', array( 'status' => 400 ) );
		}

		if ( $request->get_param( 'dryRun' ) ) {
			return rest_ensure_response(
				array(
					'dryRun' => true,
					'clean'  => $clean,
				)
			);
		}

		Haswell_Bots_Fields::write( $post->ID, $clean, $defs );
		$this->sync_post( $type, $post->ID, $clean );

		return rest_ensure_response( $this->payload( $type, get_post( $post->ID ) ) );
	}

	/**
	 * DELETE content/<type>/<id> — to the trash.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( WP_REST_Request $request ) {
		$type = $this->type( $request['type'] );
		if ( is_wp_error( $type ) ) {
			return $type;
		}
		$post = $this->item( $type, $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		if ( ! current_user_can( 'delete_post', $post->ID ) ) {
			return new WP_Error( 'haswell_bots_forbidden', "You can't remove this {$type['singular']}.", array( 'status' => 403 ) );
		}
		$title = html_entity_decode( get_the_title( $post ), ENT_QUOTES );
		if ( ! wp_trash_post( $post->ID ) ) {
			return new WP_Error( 'haswell_bots_delete_failed', "Couldn't remove {$title}.", array( 'status' => 500 ) );
		}
		return rest_ensure_response(
			array(
				'deleted' => true,
				'id'      => (int) $post->ID,
				'title'   => $title,
			)
		);
	}
}
