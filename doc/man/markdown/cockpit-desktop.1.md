% cockpit-desktop(1) | Cockpit Desktop integration

# NAME

cockpit-desktop - Cockpit Desktop integration

# SYNOPSIS

|    `**cockpit-desktop** {URLPATH} [SSH_HOST]`


# DESCRIPTION

The `cockpit-desktop` program provides secure access to Cockpit pages in
an already running desktop session. It starts a web server
(`cockpit-ws`) and a web browser in an isolated network namespace, and a
`cockpit-bridge(8)` in the running user session.

This avoids having to log into Cockpit, and having to enable
`cockpit.socket` system-wide. The network isolation ensures that no
other user, and not even other processes in the user's session, can
access this local web server.

`URLPATH` is the Cockpit page to open, i. e. the path component of
Cockpit URLs. It is highly recommended to only open a [particular page
frame](https://cockpit-project.org/guide/latest/embedding.html), not the
entire Cockpit navigation and menu. For example, the path
`/cockpit/@localhost/storage/index.html` will open the Storage page. It
is also possible to give abbreviated forms of urls, such as "`storage`"
or "`network/firewall`".

`SSH_HOST` is an optional SSH remote host specification (`hostname` or
`username@hostname`). If given, `cockpit-bridge` will be started on the
remote host through `ssh(1)` instead, i. e. the Cockpit web browser will
show that remote host. Note that this is more of an experimental/demo
feature.

# ENVIRONMENT

The `BROWSER` environment variable specifies the browser command (and
possibly options) that will be used to open the requested Cockpit page.
If not set, `cockpit-desktop` attempts to use an internal minimalistic
WebKit browser, and failing that, will attempt to detect some reasonable
alternatives.

# BUGS

Please send bug reports to either the distribution bug tracker or the
[upstream bug
tracker](https://github.com/cockpit-project/cockpit/issues/new).

# AUTHOR

Cockpit has been written by many
[contributors](https://github.com/cockpit-project/cockpit/).

# SEE ALSO

`cockpit-ws(8)`, `cockpit-bridge(1)`
