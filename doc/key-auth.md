
Cockpit Key Based Authentication
================================

Cockpit allows you to monitor and administer several servers at the same time.
While you will need to connect to the primary server with a password
or kerberos ticket, cockpit does support accessing secondary machines via
public key based authentication.

Note that when a user is authenticated in this way the authentication happens
without a password, as such the standard cockpit reauthorization mechanisms do
not work. The user will only be able to obtain additional privileges if they do not require a password.

In order to support key based authentication cockpit adds pam_ssh_add.so
to it's pam stack. Once a user is successfully logged in a new ssh-agent
is started and ssh-add is run to load the default keys, if a password is
requested the one the user logged in with is provided.

When cockpit attempts to establish an ssh connection to a new server,
the running ssh-agent is used to offer any loaded public keys to the
remote server as authentication options.

When the user logs out or has their session terminated, the ssh-agent is also
terminated.
