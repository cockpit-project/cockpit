
Cockpit URL paths
=================

This is developer documentation about the various URL paths in Cockpit
and their characteristics:

 * ```/static``` static files available without authentication. Files
   are cached for as long as possible, and names *must* change when the
   contents of the file changes.

 * ```/cache/xxxxxxxxxxxxxxx/module/path/to/file.ext``` are files which are
   cached by modules for as long as possible. The checksum changes when
   any of the contents of the given module change. Only available after
   authentication and retrieving a resource1 listing.

 * ```/res/host/module/path/to/file.ext``` are files from modules that
   are not cached. Only available after authentication.
