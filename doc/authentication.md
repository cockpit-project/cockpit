
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
 * setup an appropriate session and enviroment based on those credentials
 * launch a bridge that speaks the cockpit protocol on stdin and stdout.

The default command is ```cockpit-session``` it is able to handle basic and gssapi
authentication.

The command will be called with a single argument which is the host that the user
is connecting to.

cockpit-ws will then send contents of the Authorization http header, without the
auth scheme, on a special authentication fd to the command. For ```basic```
and ```negotiate``` auth schemes the data will be base64 decoded before sending. For
any other auth schemes. The data will be untouched.

Once the command has processed the credentials it MUST write a JSON response to the
same authentication fd. Cockpit opens this fd using SOCK_SEQPACKET so messages can be
sent and received in one operation. Each message should be no more than 65536 bytes.

By default the special authentication fd is fd #3. If your command needs to use a
different FD for some reason you may add a ```authFD``` option to your auth schema
configuration. The configured number must be greater than 2 and less than 1024.

By default cockpit-ws will wait a maximum of 30 seconds to receive this response.
The number of seconds to wait can be adjusted by adding a timeout parameter along
side the auth schema configuration in your config file. The given value should be
a number between 1 and 900.

If more information is needed the command should respond with a json object containing
a ```prompt``` string. These message will be displayed to the user and the user will be
prompted for a response. If the user does not respond within 60 seconds the command will be
closed and the login aborted. The number of seconds to wait can be adjusted by adding a
response-timeout parameter along side the auth schema configuration in your config file.
The given value should be a number between 1 and 900.

An error response should contain the following fields:

 * error: Values of ```authentication-failed```, ```authentication-unavailable``` or ```permission-denied``` are translated to the appropriate cockpit error codes. Any other values are treated as generic errors
 * message: Optional text with more details about the error.

A successful response must contain a ```user``` field with the user
name of the user that was just logged in. Additional fields may be present.

If a successful response contains a ```login-data``` field and that field contains a valid
json object that object will be included in the HTTP response sent to client.

Once the response has been sent fd #3 should be closed and a bridge should be launched
speaking the cockpit protocol on stdin and stdout.

# Remote machines

Cockpit also supports logging directly into remote machines. The remote machine to
connect to is provided by using a application name that begins with ```cockpit+=```.
The default command used for this is cockpit-ssh.

The section ```SSH-Login``` defines the options for all ssh commands. The section
has the same options as the other authentication sections with the following additions.

 * ```host``` The default host to log into. Defaults to 127.0.0.1.
 * ```allowUnknown```. By default cockpit will refuse to connect to any machines that
 are not already present in it's known_hosts file (usually ```/var/lib/cockpit/known_hosts```).
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

Like ```sshd``` cockpit can be configured to limit the number of concurrent
login attempts allowed. This is done by adding a ```MaxStartups```
option to the ```WebService``` section of your cockpit configuration.
Additional connections will be dropped until authentication succeeds or
the connections are closed. See the man page for cockpit.conf for more
details. By default the limit is set to 10.

Environment Variables
================================

The following environment variables are set by cockpit-ws when spawning an auth process

 * **COCKPIT_REMOTE_PEER** Set to the ip address of the connecting user.
 * **COCKPIT_AUTH_MESSAGE_TYPE** A string representing the type of message that will be sent on the authentication fd. When the message is passed durning login, this will be set to the value of the auth scheme that was included in the the Authorization http header.

The following environment variables are used to set options for the ```cockpit-ssh``` process.

 * **COCKPIT_SSH_ALLOW_UNKNOWN**` Set to ```1``` to  allow connecting to hosts that are not saved in the current knownhosts file. If not set cockpit will only connect to unknown hosts if either the remote_peer is local or if the ```Ssh-Login``` section in ```cockpit.conf``` has a ```allowUnknown``` option set to a truthy value (```1```, ```yes``` or ```true```).
 * **COCKPIT_SSH_KNOWN_HOSTS_FILE** Path to knownhost files. Defaults to ```PACKAGE_LOCALSTATE_DIR/known_hosts```
 * **COCKPIT_SSH_KNOWN_HOSTS_DATA** Known host data to validate against or '*' to skip validation```
 * **COCKPIT_SSH_BRIDGE_COMMAND** Command to launch after a ssh connection is established. Defaults to ```cockpit-bridge``` if not provided.
 * **COCKPIT_SSH_SUPPORTS_HOST_KEY_PROMPT** Set to ```1``` if caller supports prompting users for unknown host keys.
 * **KRB5CCNAME** Kerberos credentials cache name. Not set when no active kerberos session is active.
 * **SSH_AUTH_SOCK** When calling process has a cockpit ssh-agent already running this value is set to the FD # of . Otherwise this value is left untouched.
