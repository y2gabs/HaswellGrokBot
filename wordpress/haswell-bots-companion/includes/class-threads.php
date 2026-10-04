<?php
/**
 * Chat history for the Haswell Bots app, stored on the user's own subsite.
 *
 * Each conversation is a private `haswell_bot_thread` post owned by the user
 * who started it. The app reads and writes whole threads through
 *
 *   GET    haswell-bots/v1/threads          the user's threads, newest first
 *   POST   haswell-bots/v1/threads          start one { bot, title? }
 *   GET    haswell-bots/v1/threads/<id>     one thread with its messages
 *   POST   haswell-bots/v1/threads/<id>     replace title / messages / pending / state
 *   DELETE haswell-bots/v1/threads/<id>
 *
 * The thread body is the app's own JSON (messages, pending approvals, step
 * state). It lives in post meta rather than post_content, which kses would
 * rewrite for users without unfiltered_html. Nobody but the owner can read or
 * change a thread — not even another editor on the same site.
 *
 * @package HaswellBots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Thread storage + routes.
 */
class Haswell_Bots_Threads {

	const POST_TYPE = 'haswell_bot_thread';
	const META_KEY  = '_haswell_bot_thread';
	const MAX_BYTES = 1048576;
	const LIST_SIZE = 50;

	/**
	 * Singleton.
	 *
	 * @var Haswell_Bots_Threads|null
	 */
	private static $instance = null;

	/**
	 * Boot.
	 *
	 * @return Haswell_Bots_Threads
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
		add_action( 'init', array( $this, 'register_post_type' ) );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * A private, UI-less post type. It is not exposed under wp/v2.
	 *
	 * @return void
	 */
	public function register_post_type() {
		register_post_type(
			self::POST_TYPE,
			array(
				'label'               => 'Bot conversations',
				'public'              => false,
				'show_ui'             => false,
				'show_in_rest'        => false,
				'exclude_from_search' => true,
				'publicly_queryable'  => false,
				'rewrite'             => false,
				'query_var'           => false,
				'supports'            => array( 'title', 'author' ),
			)
		);
	}

	/**
	 * Register the routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'haswell-bots/v1',
			'/threads',
			array(
				array(
					'methods'             => 'GET',
					'permission_callback' => array( $this, 'can_use' ),
					'callback'            => array( $this, 'list_threads' ),
				),
				array(
					'methods'             => 'POST',
					'permission_callback' => array( $this, 'can_use' ),
					'callback'            => array( $this, 'create_thread' ),
				),
			)
		);

		register_rest_route(
			'haswell-bots/v1',
			'/threads/(?P<id>\d+)',
			array(
				array(
					'methods'             => 'GET',
					'permission_callback' => array( $this, 'can_use' ),
					'callback'            => array( $this, 'get_thread' ),
				),
				array(
					'methods'             => 'POST, PUT, PATCH',
					'permission_callback' => array( $this, 'can_use' ),
					'callback'            => array( $this, 'update_thread' ),
				),
				array(
					'methods'             => 'DELETE',
					'permission_callback' => array( $this, 'can_use' ),
					'callback'            => array( $this, 'delete_thread' ),
				),
			)
		);
	}

	/**
	 * The bots are for people who can edit the site.
	 *
	 * @return bool
	 */
	public function can_use() {
		return haswell_bots_can_use();
	}

	/**
	 * Load a thread the current user owns.
	 *
	 * @param int $id Post id.
	 * @return WP_Post|WP_Error
	 */
	private function owned( $id ) {
		$post = get_post( (int) $id );
		if ( ! $post || self::POST_TYPE !== $post->post_type || (int) $post->post_author !== get_current_user_id() ) {
			// One answer for "missing" and "not yours", so ids can't be probed.
			return new WP_Error( 'haswell_bots_no_thread', 'Conversation not found.', array( 'status' => 404 ) );
		}
		return $post;
	}

	/**
	 * The stored body of a thread.
	 *
	 * @param int $post_id Post id.
	 * @return array
	 */
	private function body( $post_id ) {
		$raw  = get_post_meta( $post_id, self::META_KEY, true );
		$data = is_string( $raw ) ? json_decode( $raw, true ) : null;
		return is_array( $data ) ? $data : array();
	}

	/**
	 * Full shape returned to the app.
	 *
	 * @param WP_Post $post Thread post.
	 * @return array
	 */
	private function full( $post ) {
		$body = $this->body( $post->ID );
		return array(
			'id'             => (int) $post->ID,
			'bot'            => isset( $body['bot'] ) ? $body['bot'] : '',
			'title'          => $post->post_title,
			'messages'       => isset( $body['messages'] ) ? $body['messages'] : array(),
			'pendingActions' => isset( $body['pendingActions'] ) ? $body['pendingActions'] : array(),
			// An empty object decodes to an empty PHP array; send it back as {}.
			'state'          => ! empty( $body['state'] ) ? $body['state'] : new stdClass(),
			'createdAt'      => mysql_to_rfc3339( $post->post_date_gmt ),
			'updatedAt'      => mysql_to_rfc3339( $post->post_modified_gmt ),
		);
	}

	/**
	 * GET threads.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function list_threads( WP_REST_Request $request ) {
		$bot   = (string) $request->get_param( 'bot' );
		$posts = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => 'private',
				'author'         => get_current_user_id(),
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'posts_per_page' => self::LIST_SIZE,
				'no_found_rows'  => true,
			)
		);

		$out = array();
		foreach ( $posts as $post ) {
			$body = $this->body( $post->ID );
			if ( '' !== $bot && ( ! isset( $body['bot'] ) || $body['bot'] !== $bot ) ) {
				continue;
			}
			$out[] = array(
				'id'         => (int) $post->ID,
				'bot'        => isset( $body['bot'] ) ? $body['bot'] : '',
				'title'      => $post->post_title,
				'snippet'    => $this->snippet( $body ),
				'hasPending' => $this->has_pending( $body ),
				'updatedAt'  => mysql_to_rfc3339( $post->post_modified_gmt ),
			);
		}
		return rest_ensure_response( $out );
	}

	/**
	 * Whether a change is waiting for the user's approval.
	 *
	 * @param array $body Thread body.
	 * @return bool
	 */
	private function has_pending( $body ) {
		foreach ( isset( $body['pendingActions'] ) ? (array) $body['pendingActions'] : array() as $action ) {
			if ( isset( $action['status'] ) && 'pending' === $action['status'] ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Last message's text, trimmed for the home screen list.
	 *
	 * @param array $body Thread body.
	 * @return string
	 */
	private function snippet( $body ) {
		$messages = isset( $body['messages'] ) && is_array( $body['messages'] ) ? $body['messages'] : array();
		for ( $i = count( $messages ) - 1; $i >= 0; $i-- ) {
			$role = isset( $messages[ $i ]['role'] ) ? $messages[ $i ]['role'] : '';
			if ( ! in_array( $role, array( 'user', 'assistant' ), true ) || ! empty( $messages[ $i ]['hidden'] ) ) {
				continue;
			}
			$text = isset( $messages[ $i ]['content'] ) && is_string( $messages[ $i ]['content'] ) ? $messages[ $i ]['content'] : '';
			if ( '' !== trim( $text ) ) {
				return wp_html_excerpt( wp_strip_all_tags( $text ), 140, '…' );
			}
		}
		return '';
	}

	/**
	 * POST threads.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_thread( WP_REST_Request $request ) {
		$bot = (string) $request->get_param( 'bot' );
		if ( ! preg_match( '/^[a-z0-9-]{1,40}$/', $bot ) ) {
			return new WP_Error( 'haswell_bots_bad_bot', 'A bot is required.', array( 'status' => 400 ) );
		}
		$title = sanitize_text_field( (string) $request->get_param( 'title' ) );

		$id = wp_insert_post(
			array(
				'post_type'   => self::POST_TYPE,
				'post_status' => 'private',
				'post_author' => get_current_user_id(),
				'post_title'  => '' !== $title ? $title : 'New conversation',
			),
			true
		);
		if ( is_wp_error( $id ) ) {
			return $id;
		}

		$stored = $this->store(
			$id,
			array(
				'bot'            => $bot,
				'messages'       => array(),
				'pendingActions' => array(),
				'state'          => new stdClass(),
			)
		);
		if ( is_wp_error( $stored ) ) {
			wp_delete_post( $id, true );
			return $stored;
		}

		$response = rest_ensure_response( $this->full( get_post( $id ) ) );
		$response->set_status( 201 );
		return $response;
	}

	/**
	 * GET threads/<id>.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_thread( WP_REST_Request $request ) {
		$post = $this->owned( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		return rest_ensure_response( $this->full( $post ) );
	}

	/**
	 * POST threads/<id> — replace whichever of title / messages /
	 * pendingActions / state is sent. The bot a thread belongs to never changes.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_thread( WP_REST_Request $request ) {
		$post = $this->owned( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$body = $this->body( $post->ID );
		foreach ( array( 'messages', 'pendingActions' ) as $key ) {
			if ( null !== $request->get_param( $key ) ) {
				$value = $request->get_param( $key );
				if ( ! is_array( $value ) ) {
					return new WP_Error( 'haswell_bots_bad_thread', "{$key} must be a list.", array( 'status' => 400 ) );
				}
				$body[ $key ] = array_values( $value );
			}
		}
		if ( null !== $request->get_param( 'state' ) ) {
			$state         = $request->get_param( 'state' );
			$body['state'] = is_array( $state ) ? $state : new stdClass();
		}

		$stored = $this->store( $post->ID, $body );
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}

		$update = array( 'ID' => $post->ID );
		$title  = $request->get_param( 'title' );
		if ( is_string( $title ) && '' !== trim( $title ) ) {
			$update['post_title'] = sanitize_text_field( $title );
		}
		// Always touch the post so the home screen orders by last activity.
		wp_update_post( $update );

		return rest_ensure_response( $this->full( get_post( $post->ID ) ) );
	}

	/**
	 * DELETE threads/<id>.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_thread( WP_REST_Request $request ) {
		$post = $this->owned( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		wp_delete_post( $post->ID, true );
		return rest_ensure_response(
			array(
				'deleted' => true,
				'id'      => (int) $post->ID,
			)
		);
	}

	/**
	 * Write a thread body, refusing anything implausibly large.
	 *
	 * @param int   $post_id Post id.
	 * @param array $body    Body.
	 * @return true|WP_Error
	 */
	private function store( $post_id, $body ) {
		$json = wp_json_encode( $body );
		if ( false === $json ) {
			return new WP_Error( 'haswell_bots_bad_thread', 'The conversation could not be saved.', array( 'status' => 400 ) );
		}
		if ( strlen( $json ) > self::MAX_BYTES ) {
			return new WP_Error( 'haswell_bots_thread_too_large', 'This conversation is too long to save. Start a new one.', array( 'status' => 413 ) );
		}
		update_post_meta( $post_id, self::META_KEY, wp_slash( $json ) );
		return true;
	}
}
