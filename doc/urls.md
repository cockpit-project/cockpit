
Cockpit URL paths
=================

This is developer documentation about the various URL paths in Cockpit
and their characteristics:

 * ```/static``` static files available without authentication. Files
   are cached for as long as possible, and names *must* change when the
   contents of the file changes.

 * ```/res/+module3/+module2/+module/path/to/file.ext``` are files which
   are part of various modules. Only available after authenticating.
   See below for information on how modules are described and how that
   affects caching of files. The last module is the one being referred
   to, and from which the file will be loaded.

Cockpit module descriptions
===========================

 * +xxxxxxxxxxxxxxxxxxxxxxxx the checksum of a module can be used to
   refer to the module. When referring to a module in this form the
   will be cached indefinitely.

 * +module@host is a fully qualified module loaded from the given host.
   The resources are not cached.
