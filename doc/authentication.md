
Cockpit Authentication
================================

Cockpit authorizes users by looking at the Authorization header on requests
to /login. Cockpit will attempt to perform the start the authentication command that
is configured for the auth scheme contained in the header.

To configure an auth scheme add a section to cockpit.conf for that scheme. For example
to configure an command for the "Bearer" auth scheme your cockpit.conf should contain
the following section.

```
[bearer]
command = example-verify-token
timeout = 300
```

The command is then responsible to:

 * verify the given credentials
 * setup an appropriate session and environment based on those credentials
 * launch a bridge that speaks the cockpit protocol on stdin and stdout.

The default command is ```cockpit-session``` it is able to handle basic and gssapi
authentication.

Authentication commands are called with a single argument which is the host that the user
is connecting to. They communicate with their parent process using the cockpit protocol on
stdin and stdout.

Credentials can then be retrived by issuing a authorize command with a challenge. The challenge
should correspond to the authorization type in header (ei: Basic or Bearer). For example:


```
{
    "command": "authorize",
    "cookie": "cookie",
    "challenge": "*"
}
```

The response will look something like this

```
{
    "command": "authorize",
    "cookie": "cookie",
    "response": "Basic dXNlcjpwYXNzd29yZAo=",
}
```

A ```*``` challenge requests whatever credentials the parent process has. Most auth commands will want to begin by issuing a ```*``` challenge. 

By default cockpit-ws will wait a maximum of 30 seconds to receive this response.
The number of seconds to wait can be adjusted by adding a timeout parameter along
side the auth schema configuration in your config file. The given value should be
a number between 1 and 900.

If more information is needed the command should respond with a ```X-Conversation``` challenge.
This takes the following format.

```
X-Conversation nonce base64(prompt message)
```

The message will be displayed to the user and the user will be prompted for a response.
If the user does not respond within 60 seconds the command will be closed and the login
aborted. The number of seconds to wait can be adjusted by adding a response-timeout parameter
along side the auth schema configuration in your config file. The given value should be a
number between 1 and 900.

Once a result is known a "init" command should be sent. If the login was succussful you can usually
just let the bridge do this.

If the login was not successful the JSON should include a problem field. Values of
```authentication-failed```, ```authentication-unavailable``` or ```access-denied```
are translated to the appropriate cockpit error codes. Any other values are treated
as generic errors. Additionally a message field may be included as well.

If an process exits without sending a init command, that will be treated as an internal error.

If the authentication command has additional data that it would like to return with a successful response
it can do so by sending a ```x-login-data``` challenge. The command should have an additional JSON field
```login-data```. The string placed there will be returned by along with a successful json response.

For a simple python example see:

[https://github.com/cockpit-project/cockpit/blob/master/containers/bastion/cockpit-auth-ssh-key]

# Remote machines

Cockpit also supports logging directly into remote machines. The remote machine to
connect to is provided by using a application name that begins with ```cockpit+=```.
The default command used for this is cockpit-ssh.

The section ```SSH-Login``` defines the options for all ssh commands. The section
has the same options as the other authentication sections with the following additions.

 * ```host``` The default host to log into. Defaults to 127.0.0.1.
 * ```allowUnknown```. By default cockpit will refuse to connect to any machines that
 are not already present in ssh's global known_hosts file (usually ```/etc/ssh/ssh_known_hosts```).
 Set this to ```true``` is to allow those connections to proceed.

# Actions

Setting an action can modify the behavior for an auth scheme. Currently two actions
are supported.

 * **remote-login-ssh** Use the ```SSH-Login``` section instead.
 * **none** Disable this auth scheme.

To configure an action add the ```action``` option. For example to disable basic authentication.
cockpit.conf should contain the following section.

```
[basic]
action = none
```

# Limits

Cockpit can be configured to limit the number of concurrent login processes. See cockpit.conf
for more details. This will affect how many custom authentication processes can be launched.

Environment Variables
================================

The following environment variables are set by cockpit-ws when spawning an auth process

 * **COCKPIT_REMOTE_PEER** Set to the ip address of the connecting user.

The following environment variables are used to set options for the ```cockpit-ssh``` process.

 * **COCKPIT_SSH_ALLOW_UNKNOWN**` Set to ```1``` to  allow connecting to hosts that are not saved in the current knownhosts file. If not set cockpit will only connect to unknown hosts if either the remote_peer is local or if the ```Ssh-Login``` section in ```cockpit.conf``` has a ```allowUnknown``` option set to a truthy value (```1```, ```yes``` or ```true```).
 * **COCKPIT_SSH_KNOWN_HOSTS_FILE** Path to knownhost files. Defaults to ```PACKAGE_SYSCONF_DIR/ssh/ssh_known_hosts```
 * **COCKPIT_SSH_KNOWN_HOSTS_DATA** Known host data to validate against or '*' to skip validation```
 * **COCKPIT_SSH_BRIDGE_COMMAND** Command to launch after a ssh connection is established. Defaults to ```cockpit-bridge``` if not provided.
