<?php
// Stand-in for the Haswell theme: the CPTs and their ACF field groups.
add_action( 'init', function () {
	foreach ( array( 'services', 'team_members', 'partners', 'announcements', 'website_settings' ) as $t ) {
		register_post_type( $t, array( 'public' => true, 'label' => $t, 'show_in_rest' => true, 'supports' => array( 'title', 'editor', 'thumbnail' ) ) );
	}
} );
add_action( 'acf/init', function () {
	$group = function ( $key, $type, $fields ) {
		acf_add_local_field_group( array(
			'key'      => "group_$key",
			'title'    => $key,
			'fields'   => $fields,
			'location' => array( array( array( 'param' => 'post_type', 'operator' => '==', 'value' => $type ) ) ),
		) );
	};
	$f = function ( $name, $label, $type, $extra = array() ) {
		return array_merge( array( 'key' => "field_$name", 'name' => $name, 'label' => $label, 'type' => $type ), $extra );
	};
	$group( 'services', 'services', array(
		$f( 'service_name', 'Service Name', 'text', array( 'required' => 1 ) ),
		$f( 'service_main_image', 'Service Main Image', 'image' ),
		$f( 'service_description', 'Service Description', 'wysiwyg', array( 'required' => 1 ) ),
		$f( 'service_gallery', 'Gallery', 'gallery' ),
	) );
	$group( 'team', 'team_members', array(
		$f( 'member_photo', 'Member Photo', 'image' ),
		$f( 'member_full_name', 'Full Name', 'text', array( 'required' => 1 ) ),
		$f( 'professional_title', 'Professional Title', 'text', array( 'required' => 1 ) ),
		$f( 'member_email_address', 'Email Address', 'email' ),
	) );
	$group( 'partners', 'partners', array(
		$f( 'partner_name', 'Partner Name', 'text' ),
		$f( 'partner_logo', 'Partner Logo', 'image' ),
		$f( 'partner_external_link', 'Partner External Link', 'url' ),
	) );
	$group( 'announcements', 'announcements', array(
		$f( 'announcement_subject', 'Title', 'text', array( 'required' => 1 ) ),
		$f( 'announcement_featured_image', 'Featured Image', 'image' ),
		$f( 'announcement_body', 'Mail Body', 'wysiwyg', array( 'required' => 1 ) ),
	) );
	// One group on the whole post type, as on the real sites.
	$group( 'website_settings', 'website_settings', array(
		$f( 'company_name', 'Company Name', 'text' ),
		$f( 'short_tagline', 'Short Tagline', 'text' ),
		$f( 'long_tagline', 'Long Tagline', 'textarea' ),
		$f( 'company_phone_number', 'Company Phone Number', 'text' ),
		$f( 'company_email', 'Company Email', 'email' ),
		$f( 'website_header_image', 'Website Header Image', 'image' ),
	) );
} );
// Records that acf/save_post fired for settings (stands in for the fan-out).
add_action( 'acf/save_post', function ( $id ) {
	if ( 'website_settings' === get_post_type( $id ) ) {
		update_option( 'test_settings_saved', (int) $id );
	}
} );
