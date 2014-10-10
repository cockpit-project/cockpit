
Cockpit URL paths
=================

This is developer documentation about the various URL paths in Cockpit
and their characteristics:

 * ```/static``` static files available without authentication. Files
   are cached for as long as possible, and names *must* change when the
   contents of the file changes.

 * ```/cockpit/!xxxxxxxxxxxxxxx/path/to/file.ext``` are files which are
   cached by packages for as long as possible. The checksum changes when
   any of the contents of the given package change. Only available after
   authentication and retrieving a resource1 listing.

 * ```/cockpit/package/path/to/file.ext``` or ```/cockpit/package@host/path/to/file.ext```
   are files from packages (on specific hosts, or local machine if no host specified)
   that are not cached. Only available after authentication.
