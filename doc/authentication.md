
Cockpit Authentication
================================

Cockpit authorizes users by looking at the Authorization header on requests
to /login. Cockpit will atempt to perform the authentication action that
is configured for the auth scheme contained in the header.

Cockpit supports the following authentication actions:

 * spawn-login-with-header
 * spawn-login-with-decoded
 * remote-ssh-login
 * none

To configure an auth scheme add a section to cockpit.conf for that scheme. For example
to configure an action for the "Bearer" auth scheme your cockpit.conf should contain
the following section.

```
[bearer]
action = spawn-login-with-header
command = example-verify-token
```

When no configuration exists ```spawn-login-with-decoded``` is the default.

# Spawning

The ```spawn-login-with-header``` and ```spawn-login-with-decoded```
actions send the contents of the Authorization header to an external command
that is then responsible to:

 * verify the given credentials
 * setup an appropriate session and enviroment based on those credentials
 * launch a bridge that speaks the cockpit protocol on stdin and stdout.

These actions are identical except that ```spawn-login-with-decoded``` base64
decodes the contents of the Authorization header before sending it to the spawned
process while ```spawn-login-with-header```sends the data as is.

These spawning actions should be configured with the name of the command to run.
For example

```
[bearer]
action = spawn-login-with-header
command = example-verify-token
```

The default command is ```cockpit-session``` it is able to handle basic and gssapi
authentication.

The command will be called with two arguments

 * type: the auth scheme that was included in the the Authorization http header
 * remote host: The remote host to use with pam.

cockpit-ws will then send contents of the Authorization http header, without the
auth scheme, on fd #3 to the command. Once the command has processed the credentials
it MUST write a JSON response to fd #3.

An error response should contain the following fields:

 * error: Values of ```authentication-failed```, ```authentication-unavailable``` or ```permission-denied``` are translated to the appropriate cockpit error codes. Any other values are treated as generic errors
 * message: Optional text with more details about the error.

A successful response must contain a ```user``` field with the user
name of the user that was just logged in. Additional fields may be present.

If a successful response contains a ```login-data``` field and that field contains a valid
json object that object will be included in the HTTP response sent to client.

Once the response has been sent fd #3 should be closed and a bridge should be launched
speaking the cockpit protocol on stdin and stdout.

# SSH Logins

The ```remote-login-ssh``` action uses ssh to authenticate the user and and launch a bridge.
Currently this should only be used with basic authentication.

For example

```
[basic]
action = remote-ssh-login
host = 10.10.122.12
```

If not provided host will default to 127.0.0.1

# None

The ```none``` action forces an immediate authentication denied message.

# Limits

Like ```sshd``` cockpit can be configured to limit the number of concurrent
login attempts allowed. This is done by adding a ```MaxStartups```
option to the ```WebService``` section of your cockpit configuration.
Additional connections will be dropped until authentication succeeds or
the connections are closed. See the man page for cockpit.conf for more
details. By default the limit is set to 10.
