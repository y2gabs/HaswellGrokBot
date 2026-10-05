<?php
// Test router for PHP's built-in server: a subdirectory multisite without rewrite rules.
$root = getenv( "WP_ROOT" ) ?: __DIR__ . "/wp";
$path = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
// Multisite subdirectory: /acme/wp-admin/x.php → /wp-admin/x.php
if ( preg_match( '#^/[^/]+(/(wp-(content|admin|includes)/.*|[^/]+\.php))$#', $path, $m ) && ! file_exists( $root . $path ) ) {
	$path = $m[1];
}
if ( '/' !== $path && file_exists( $root . $path ) && ! is_dir( $root . $path ) ) {
	if ( substr( $path, -4 ) === '.php' ) {
		$_SERVER['SCRIPT_NAME'] = $path;
		$_SERVER['SCRIPT_FILENAME'] = $root . $path;
		chdir( dirname( $root . $path ) );
		require $root . $path;
		return true;
	}
	// Serve static files ourselves: the path may have been rewritten above.
	$types = array( 'css' => 'text/css', 'js' => 'application/javascript', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp', 'svg' => 'image/svg+xml' );
	$ext   = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
	header( 'Content-Type: ' . ( isset( $types[ $ext ] ) ? $types[ $ext ] : ( mime_content_type( $root . $path ) ?: 'application/octet-stream' ) ) );
	readfile( $root . $path );
	return true;
}
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = $root . '/index.php';
chdir( $root );
require $root . '/index.php';
