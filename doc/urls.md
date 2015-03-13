
Cockpit URL paths
=================

This is developer documentation about the various URL paths in Cockpit
and their characteristics:

 * ```/cockpit/static``` static files available without authentication. Files
   are cached for as long as possible, and names *must* change when the
   contents of the file changes.

 * ```/cockpit/$xxxxxxxxxxxxxxx/package/path/to/file.ext``` are files which
   are cached by packages for as long as possible. The checksum changes when
   any of the packages on a system change. Only available after 
   authentication.

 * ```/cockpit/@host/package/path/to/file.ext``` are files from packages (on
   specific hosts) that are not cached. Only available after authentication.

 * ```/cockpit/@host/checksum``` returns the checksum of the host packages
   or an empty string if none

 * ```/cockpit/@host/manifests.json``` includes a summary of all the manifest
   files from all the packages

 * ```/cockpit/@host/manifests.js``` includes a summary of all the manifest
   files from all the packages, as an AMD loadable module
