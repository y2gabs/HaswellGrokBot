<?php
/**
 * ACF field discovery and value handling shared by the settings and content
 * routes.
 *
 * Field definitions are read from ACF itself (the field groups attached to a
 * post), so the bots always see the real field names, labels and types —
 * "Long Tagline" → long_tagline — without a hand-kept copy that can drift.
 *
 * Only simple field types are writable. Anything else (galleries, repeaters,
 * relationships, taxonomies…) is reported read-only so the bot can tell the
 * user to change it in the admin app instead of guessing at a format.
 *
 * @package HaswellBots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Field helpers.
 */
class Haswell_Bots_Fields {

	/**
	 * ACF types the bots may write, and how each is cleaned.
	 */
	const WRITABLE_TYPES = array( 'text', 'textarea', 'wysiwyg', 'email', 'url', 'number', 'true_false', 'image', 'select', 'radio', 'date_picker' );

	/**
	 * ACF field definitions that apply to a post, or to a post type when no
	 * post exists yet (creating a new item).
	 *
	 * @param int|null    $post_id   Existing post, or null.
	 * @param string|null $post_type Post type when there is no post.
	 * @return array[] Field arrays from ACF, keyed by field name.
	 */
	public static function definitions( $post_id = null, $post_type = null ) {
		if ( ! function_exists( 'acf_get_field_groups' ) ) {
			return array();
		}

		$filter = $post_id ? array( 'post_id' => (int) $post_id ) : array( 'post_type' => (string) $post_type );
		$out    = array();
		foreach ( acf_get_field_groups( $filter ) as $group ) {
			foreach ( (array) acf_get_fields( $group ) as $field ) {
				if ( empty( $field['name'] ) || in_array( $field['type'], array( 'tab', 'message', 'accordion' ), true ) ) {
					continue;
				}
				$out[ $field['name'] ] = $field;
			}
		}
		return $out;
	}

	/**
	 * Compact, model-friendly description of one field.
	 *
	 * @param array $field ACF field.
	 * @return array
	 */
	public static function describe( $field ) {
		$out = array(
			'name'     => $field['name'],
			'label'    => isset( $field['label'] ) ? $field['label'] : $field['name'],
			'type'     => $field['type'],
			'writable' => in_array( $field['type'], self::WRITABLE_TYPES, true ),
		);
		if ( ! empty( $field['required'] ) ) {
			$out['required'] = true;
		}
		if ( ! empty( $field['instructions'] ) ) {
			$out['help'] = wp_strip_all_tags( $field['instructions'] );
		}
		if ( in_array( $field['type'], array( 'select', 'radio' ), true ) && ! empty( $field['choices'] ) ) {
			$out['choices'] = array_keys( (array) $field['choices'] );
		}
		return $out;
	}

	/**
	 * A field's current value in a JSON-friendly form. Images come back as
	 * { id, url } so the bot can both show and reuse them.
	 *
	 * @param array $field   ACF field.
	 * @param int   $post_id Post id.
	 * @return mixed
	 */
	public static function read( $field, $post_id ) {
		$raw = get_field( $field['name'], $post_id, false );

		if ( 'image' === $field['type'] ) {
			$id = is_array( $raw ) && isset( $raw['ID'] ) ? (int) $raw['ID'] : (int) $raw;
			if ( ! $id ) {
				return null;
			}
			return array(
				'id'  => $id,
				'url' => wp_get_attachment_image_url( $id, 'large' ),
			);
		}
		if ( 'true_false' === $field['type'] ) {
			return (bool) $raw;
		}
		if ( is_scalar( $raw ) || null === $raw ) {
			return $raw;
		}
		// Complex values are shown, not edited; keep them small.
		$json = wp_json_encode( $raw );
		return is_string( $json ) && strlen( $json ) <= 2000 ? $raw : '(complex value — edit in the admin app)';
	}

	/**
	 * Validate and clean a value for writing.
	 *
	 * @param array $field ACF field.
	 * @param mixed $value Incoming value.
	 * @return mixed|WP_Error Clean value.
	 */
	public static function clean( $field, $value ) {
		$label = isset( $field['label'] ) ? $field['label'] : $field['name'];

		if ( ! in_array( $field['type'], self::WRITABLE_TYPES, true ) ) {
			return new WP_Error( 'haswell_bots_read_only', "{$label} can't be changed from the bots. Use the admin app.", array( 'status' => 400 ) );
		}

		if ( null === $value ) {
			$value = '';
		}

		switch ( $field['type'] ) {
			case 'text':
				return sanitize_text_field( (string) $value );
			case 'textarea':
				return sanitize_textarea_field( (string) $value );
			case 'wysiwyg':
				return wp_kses_post( (string) $value );
			case 'email':
				$email = sanitize_email( (string) $value );
				if ( '' !== (string) $value && ! is_email( $email ) ) {
					return new WP_Error( 'haswell_bots_bad_value', "{$label} must be a valid email address.", array( 'status' => 400 ) );
				}
				return $email;
			case 'url':
				$url = esc_url_raw( trim( (string) $value ) );
				if ( '' !== trim( (string) $value ) && '' === $url ) {
					return new WP_Error( 'haswell_bots_bad_value', "{$label} must be a full web address (https://…).", array( 'status' => 400 ) );
				}
				return $url;
			case 'number':
				if ( '' === $value ) {
					return '';
				}
				if ( ! is_numeric( $value ) ) {
					return new WP_Error( 'haswell_bots_bad_value', "{$label} must be a number.", array( 'status' => 400 ) );
				}
				return $value + 0;
			case 'true_false':
				return $value && 'false' !== $value && '0' !== $value ? 1 : 0;
			case 'image':
				if ( is_array( $value ) && isset( $value['id'] ) ) {
					$value = $value['id'];
				}
				if ( '' === $value || 0 === (int) $value ) {
					return '';
				}
				$id = (int) $value;
				if ( 'attachment' !== get_post_type( $id ) || ! wp_attachment_is_image( $id ) ) {
					return new WP_Error( 'haswell_bots_bad_value', "{$label} must be an image from the media library.", array( 'status' => 400 ) );
				}
				return $id;
			case 'select':
			case 'radio':
				$choices = array_map( 'strval', array_keys( (array) $field['choices'] ) );
				if ( '' !== (string) $value && ! in_array( (string) $value, $choices, true ) ) {
					return new WP_Error( 'haswell_bots_bad_value', "{$label} must be one of: " . implode( ', ', $choices ) . '.', array( 'status' => 400 ) );
				}
				return (string) $value;
			case 'date_picker':
				$value = preg_replace( '/[^0-9]/', '', (string) $value );
				if ( '' !== $value && 8 !== strlen( $value ) ) {
					return new WP_Error( 'haswell_bots_bad_value', "{$label} must be a date (YYYY-MM-DD).", array( 'status' => 400 ) );
				}
				return $value;
		}
		return new WP_Error( 'haswell_bots_read_only', "{$label} can't be changed from the bots.", array( 'status' => 400 ) );
	}

	/**
	 * Validate a whole { name: value } map against a post's fields, without
	 * writing anything. Unknown and hidden names are rejected rather than
	 * dropped, so the bot finds out it used the wrong name.
	 *
	 * @param array    $values  Incoming values.
	 * @param array[]  $defs    Field definitions keyed by name.
	 * @param string[] $hidden  Names that may not be written.
	 * @return array|WP_Error Clean values keyed by name.
	 */
	public static function clean_all( $values, $defs, $hidden = array() ) {
		if ( ! is_array( $values ) ) {
			return new WP_Error( 'haswell_bots_bad_fields', 'fields must be an object of field name to value.', array( 'status' => 400 ) );
		}
		$clean = array();
		foreach ( $values as $name => $value ) {
			if ( ! isset( $defs[ $name ] ) || in_array( $name, $hidden, true ) ) {
				return new WP_Error(
					'haswell_bots_unknown_field',
					sprintf( 'Unknown field "%s". Known fields: %s.', $name, implode( ', ', array_diff( array_keys( $defs ), $hidden ) ) ),
					array( 'status' => 400 )
				);
			}
			$cleaned = self::clean( $defs[ $name ], $value );
			if ( is_wp_error( $cleaned ) ) {
				return $cleaned;
			}
			$clean[ $name ] = $cleaned;
		}
		return $clean;
	}

	/**
	 * Write clean values and run the theme's / admin plugin's save logic
	 * (title sync, excerpts, the website_settings fan-out to pages).
	 *
	 * @param int     $post_id Post id.
	 * @param array   $clean   Values from clean_all().
	 * @param array[] $defs    Field definitions keyed by name.
	 * @return void
	 */
	public static function write( $post_id, $clean, $defs ) {
		foreach ( $clean as $name => $value ) {
			// Field key, not name: it works on a post that has never had the
			// field saved, where a name lookup has no reference to follow.
			update_field( $defs[ $name ]['key'], $value, $post_id );
		}
		do_action( 'acf/save_post', $post_id );
	}

	/**
	 * Every field's current value, with its description.
	 *
	 * @param int      $post_id Post id.
	 * @param array[]  $defs    Field definitions keyed by name.
	 * @param string[] $hidden  Names to leave out.
	 * @return array[] name => { label, type, writable, value, … }
	 */
	public static function snapshot( $post_id, $defs, $hidden = array() ) {
		$out = array();
		foreach ( $defs as $name => $field ) {
			if ( in_array( $name, $hidden, true ) ) {
				continue;
			}
			$entry          = self::describe( $field );
			$entry['value'] = self::read( $field, $post_id );
			unset( $entry['name'] );
			$out[ $name ] = $entry;
		}
		return $out;
	}
}
