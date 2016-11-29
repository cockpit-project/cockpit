
Cockpit URL paths
=================

This is developer documentation about the various resource paths in Cockpit
and their characteristics. This doesn't apply to the visible URLs shown
in the main Cockpit address bar.

Cockpit URLs are based on an application. A valid application name is
either the word ```cockpit``` or a string that begins with ```cockpit+```
for example ```cockpit+application-name```. Each of the following URLs
are valid for any application, just replace ```/cockpit/``` with ```/cockpit+application-name/```

 * ```/cockpit/static``` static files available without authentication. Files
   are cached for as long as possible, and names *must* change when the
   contents of the file changes. The exception to this is when the application
   refers to a different machine. In that case the user must be authenticated
   to serve those files and the cache varies on cookie.

 * ```/cockpit/login``` authenticates a user and sets cookie based on application
 name.

 * ```/cockpit/$xxxxxxxxxxxxxxx/package/path/to/file.ext``` are files which
   are cached by packages for as long as possible. The checksum changes when
   any of the packages on a system change. Only available after authentication.

 * ```/cockpit/@host/package/path/to/file.ext``` are files from packages (on
   specific hosts) that are not cached. Only available after authentication.

 * ```/cockpit/@host/manifests.json``` includes a summary of all the manifest
   files from all the packages

 * ```/cockpit/@host/manifests.js``` includes a summary of all the manifest
   files from all the packages, as an AMD loadable module

 * ```/cockpit/socket``` The main web socket

 * ```/cockpit/channel/csrftoken?query``` External channel URLs

When loading through cockpit-ws any URL that does not begin with an
application will be handled by the shell (shell/index.html by default)
using the default application ```cockpit```.


Direct to machine urls
======================

Cockpit-ws supports logging in directly to a remote machine, without first
authenticating on the machine that cockpit-ws is running on. A cockpit-ssh
processes is spawned that connects via SSH to the remote machine and all
requests are proxied via that connection.

To use this feature the application name MUST begin with an ```=``` for
example ```/cockpit+=machine/socket``` will attempt to open a socket on
```machine``` ```/cockpit+machine/socket``` will attempt to open a socket
on localhost.

When loading through cockpit-ws any URL that does not begin with an
application will be handled by the shell (shell/index.html by default)
using the default application ```cockpit```.

In addition any url that begins with ```/=``` will attempt to load
the shell from the specified machine. For example a URL of
```/=machine/system``` will attempt to load ```shell/index.html```
from ```machine``` using the application ```cockpit+machine```.
