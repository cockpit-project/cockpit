
Protocol Documentation
======================

The protocol is an implementation detail of Cockpit. It's a simple wrapper over
some other protocols, like DBus, REST, and so on. Use those instead.

Don't use this. This document ends here. It will self-destruct within 10
seconds. Leave now while you still can.

Channels
--------

Each message is part of a channel, which has a id. This channel id
identifies the type of data in the message payload, the host where it is
headed to/from and things like the service or user credentials.

An empty/missing channel id represents a special channel called the control
channel. It contains command messages. These are described below. Initially
only the control channel exists. Additional channels are opened and closed
via command messages.

Channels operate across all participants, and they help the cockpit-ws
forwarding layer to know where to send messages.

Framing
-------

The channel id is a string and ends with a newline.  It may not
contain a newline, and must be utf8 valid. After this comes the
channel dependent payload.

For example if you had a payload of the string 'abc', and it was being
sent through the channel 'a5', that might look like:

    a5\nabc

When a message is sent over a stream transport that does not have distinct
messages (such as SSH or stdio), the message is also prefixed with a 32-bit MSB
length in bytes of the message. The length does not include the 4 bytes
of the length itself.

An example. When going over a stream transport with a payload of the 3 byte
string 'abc', and a channel of 'a5', would have a message length of 6: 3 bytes of
payload, 2 bytes for the channel number, 1 for the new line. It would look like
this on the wire:

    |----msb length---| |----chan----| |---payload--|
    0x00 0x00 0x00 0x06 0x61 0x35 0x0A 0x61 0x62 0x63

Control Messages
----------------

Control messages let the various components such as cockpit-web, cockpit-ws and
cockpit-bridge communicate about what's going on.

Control messages are always sent in the control channel. They always have an
empty channel. The payload of a control message is always a json
object. There is always a "command" field:

    {
        "command": <command>,
        "channel": <channel>,
        ...
    }

If a control message pertains to a specific channel it has a "channel" field
containing the id of the channel. It is invalid to have a present but empty
"channel" field.

Unknown control messages are ignored. Unlike payload messages, control messages
are not forwarded unless explicitly for the specific command below.

Command: init
-------------

The "init" command is the first message sent over a new transport. It is
an error if any other message is received first. The transport is not considered
open until the "init" message has been received.

The following fields are defined:

 * "version": The version of the protocol. Currently zero, and unstable.
 * "channel-seed": A seed to be used when generating new channel ids.
 * "default-host": The default host to put in "open" messages.
 * "user": An object containing information about the logged in user.
 * "problem": A problem occurred during init.

If a problem occurs that requires shutdown of a transport, then the "problem"
field can be set to indicate why the shutdown will be shortly occurring.

The "init" command message may be sent multiple times across an already open
transport, if certain parameters need to be renegotiated.

Command: open
-------------

The "open" command opens a new channel for payload.

The following fields are defined:

 * "binary": If present, either "base64" or "raw"
 * "channel": A uniquely chosen channel id
 * "payload": A payload type, see below
 * "host": The destination host for the channel, defaults to "localhost"
 * "user": Optional alternate user for authenticating with host
 * "superuser": When true, try to run this channel as root.

If "binary" is set then this channel transfers binary messages. If "binary"
is set to "base64" then messages in the channel are encoded using "base64",
otherwise if it's set to "raw" they are transferred directly.

These optional fields are used when establishing a channel over a new
connection with a host. If a connection is already open for the given
"host" and "user" then these will not be used.

 * "password": Optional alternate password for authenticating with host
 * "host-key": Optional ssh public hostkey to expect when connecting to machine

After the command is sent, then the channel is assumed to be open. No response
is sent. If for some reason the channel shouldn't or cannot be opened, then
the recipient will respond with a "close" message.

The channel id must not already be in use by another channel.

An example of an open:

    {
        "command": "open",
        "channel": "a4",
        "payload": "stream",
        "host": "localhost"
    }

This message is forwarded on to the cockpit-bridge. This message is sent from
the cockpit-web frontend or cockit-ws.

Command: close
--------------

The "close" command closes a channel.

The following fields are defined:

 * "channel": The id of the channel to close
 * "problem": A short problem code for closure, or empty for a normal close

The channel id must be set.  An example of a close:

    {
        "command": "close",
        "channel" : "5x",
        "problem": "not-authorized"
    }

Any protocol participant can send this message. The cockpit-bridge and cockpit-ws
backends will send this message when a channel closes whether because of an
error or a normal closure. The frontend cockpit-web will send this when it
wants to close a channel normally.

See below for a list of problem codes.

Other fields may be present in a close message.

In the case of a connection that fails wiwh the problem "unknown-hostkey" the
host key for the server will be included in a "host-key" field in the close
message.

This message is forwarded on to the cockpit-bridge.

Command: ping
-------------

The "ping" command is simply a keep alive.

No additional fields are defined.

An example of a ping:

    {
        "command": "ping",
    }

Any protocol participant can send this message, but it is not responded to.

Command: authorize
------------------

The "authorize" command is for communication of reauthorization challenges
and responses between cockpit-bridge and cockpit-ws.

The following fields are defined:

 * "cookie": an string sent with a challenge, that must be present in
   the corresponding response.
 * "challenge": a challenge string from the reauthorize component, present
   in messages from cockpit-bridge to cockpit-ws
 * "response": a response string from the reauthorize component, present
   in messages from cockpit-ws to cockpit-bridge

The contents of the "challenge" and "response" fields are defined and
documented in the reauthorize component.

Example authorize challenge and response messages:

    {
        "command": "authorize",
        "cookie": "555",
        "challenge": "crypt1:74657374:$6$2rcph,noe92ot..."
    }

    {
        "command": "authorize",
        "cookie": "555",
        "response": "crypt1:$6$r0oetn2039ntoen..."
    }

Command: logout
---------------

The "logout" command is sent by the shell to cockpit-ws. It discards credentials
for the logged in user. Optionally it disconnects the user.

The following fields are defined:

 * "disconnect": if set to true then disconnect the user

Example logout message:

    {
        "command": "logout",
        "disconnect": true
    }

The "logout" command is forwarded to all bridge instances.

Payload: null
-------------

A channel opened with this payload type will never send data, and will
ignore all data it receives.

Payload: echo
-------------

A channel opened with this payload type will send back all data that
it receives.


Payload: resource2
------------------

These payloads contain resource data, such as javascript and html files that
make up cockpit packages. Typically, channels of this type are opened between
cockpit-ws and cockpit-bridge. See doc/packages.md

Additional "open" command options are available to open a channel of this
type:

 * "package": the package to retrieve resource from
 * "path": path of the resource within the package.
 * "accept": array of various file extensions for content negotation

The "package" may either be fully qualified (ie: package@host), although the
host part is not used for routing, and the usual "open" command "host"
option should be used. The package may also be a package checksum.

If "accept" includes "minified" then a minified form of the file will
be selected, if it is available.

The first channel payload will be a JSON object, containing the following
options, related to headers.

 * "accept": the content negotiation option accepted

The remaining channel payloads will be the raw (possibly binary) byte data
of the resource being retrieved.

If "package" and "path" are missing, then the channel will be immediately
closed without a "problem", and a combined manifest of all packages, including
checksums for system packages will be returned in the "close" message under
the "packages" option:

    {
        "command": "close",
        "channel": "5",
        "packages": [
            {
                "id": ["app1", "$0d599f0ec05c3bda8c3b8a68c32a1b47"],
                "manifest" : { ... }
            },
            ...
        ]
    }

The resource1 payload is no longer supported.


Payload: dbus-json3
-------------------

DBus messages are encoded in JSON payloads by cockpit-web, and decoded in
cockpit-bridge. The 'dbus-json1' and 'dbus-json2' protocols are deprecated
and not documented.

Additional "open" command options are needed to open a channel of this
type:

 * "bus": The DBus bus to connect to either "session" or "system",
   defaults to "system" if not present.
 * "name": A service name of the DBus service to communicate with.

The DBus bus name is started on the bus if it is not already running. If it
could not be started the channel is closed with a "not-found". If the DBus
connection closes, the channel closes with "disconnected". The channel will
also close, without a problem, if the bus name goes away (ie: the service
exits).

DBus messages are encoded as JSON objects. If an unrecognized JSON object
is received, then the channel is closed with a "protocol-error".

Method calls are a JSON object with a "call" field, whose value is an array,
with parameters in this order: path, interface, method, in arguments.

    {
        "call": [ "/path", "org.Interface", "Method", [ "arg0", 1, "arg2" ] ],
        "id": "cookie"
    }

All the various parameters must be valid for their use. arguments may be
null if no DBus method call body is expected. If a "type" field is specified
then it is expected to be the DBus method type signature (no tuple). If a
"flags" field is a string, then this includes message flags. None are
defined yet.

If a DBus method call fails an "error" message will be sent back. An error
will also be sent back in parameters or arguments in the "call" message are
invalid.

An optional "id" field indicates that a response is desired, which will be
sent back in a "reply" or "error" message with the same "id" field.

Method reply messages are JSON objects with a "reply" field whose value is
an array, the array contains another array of out arguments, or null if
the DBus reply had no body.
    {
        "reply": [ [ "arg0", 1, 2 ] ],
        "id": "cookie"
    }

If the call had a "type" field, then the reply will have one too containing
the DBus type signature of the arguments. If a "flags" field was present on
the call, then "flags" will also be present on the reply. Valid out flags
are:

 * ">": Big endian message
 * "<": Little endian message

An error message is JSON object with an "error" field whose value is an
array. The array contains: error name, error arguments

    {
        "error": [ "org.Error", [ "Usually a message" ] ]
	"id": "cookie"
    }

To receive signals you must subscribe to them. This is done by sending a
"add-match" message. It contains various fields to match on. If a field
is missing then it is treated as a wildcard.

"path" limits the signals to those sent by that DBus object path, it must
be a valid object path according to the specification. "path_namespace"
limits signals to the subtree of DBus object paths. It must be a valid
object path according to the specification, and may not be specified
together with "path".

"interface" limits the signals to those sent on the given DBus interface,
and must be a valid interface name. "member" limits the signal to those
of that signal name. "arg0" limits the signals to those that have the
given string as their first argument. If any of the values are not
valid according to the dbus specification, the channel will close with
a "protocol-error".

    {
        "add-match": {
            "path": "/the/path",
            "interface": "org.Interface",
            "member": "SignalName",
            "arg0": "first argument",
        }
    }

To unsubscribe from DBus signals, use the "remove-match" message. If a
match was added more than once, it must be removed the same number of
times before the signals are actually unsubscribed.

The form of "remove-match" is identical to "add-match".

    {
        "remove-match": {
            "path": "/the/path",
            "interface": "org.Interface",
            "member": "SignalName",
            "arg0": "first argument",
        }
    }

Signals are sent in JSON objects that have a "signal" field, which is an
array of parameters: path, interface, signal name, and arguments. arguments
may be null if the DBus signal had no body.

    {
        "signal": [ "/the/path", "org.Interface", "SignalName", [ "arg0", 1, 2 ] ]
    }

Properties can be watched with the "watch" request. Either a "path" or
"path_namespace" can be watched. Property changes are listened for with
DBus PropertiesChanged signals.  If a "path_namespace" is watched and
path is a DBus ObjectManager, then it is used to watch for new DBus
interfaces, otherwise DBus introspection is used. The "id" field is
optional, if present a "reply" will be sent with this same "id" when
the watch has sent "notify" messages about the things being watched.

    {
        "watch": {
	    "path": "/the/path/to/watch",
            "interface": org.Interface
        }
	"id": 5
    }

To remove a watch, pass the identical parameters with an "unwatch"
request.

    {
        "unwatch": {
            "path": "/the/path/to/watch"
        }
    }

Property changes will be sent using a "notify" message. This includes
addition of interfaces without properties, which will be an empty
interface object, or interfaces removed, which will be null. Only the
changes since the last "notify" message will be sent.

    {
	"notify": {
            "/a/path": {
                "org.Interface1": {
                    "Prop1": x,
                    "Prop2": y
                },
		"org.Interface2": { }
            },
            "/another/path": {
                "org.Removed": null
            }
        }
    }

Interface introspection data is sent using "meta" message. Before the
first time an interface is sent using a "notify" message, a "meta"
will be sent with that interface introspection info. Additional fields
will be defined here, but this is it for now.

    {
        "meta": {
            "org.Interface": {
                "methods": {
                    "Method1": { },
                    "Method2": { }
                },
                "properties": {
                    "Prop1": { "flags": "rw" },
                    "Prop2": { "flags": "r" }
                }
            }
        }
    }

DBus types are encoded in various places in these messages, such as the
arguments. These types are encoded as follows:

 * byte, int16, uint16, int32, uint32, int64, uint64, double: encoded
   as a JSON number
 * boolean: encoded as a JSON boolean
 * string, object-path, signature: encoded as JSON strings
 * array of bytes: encoded as a base64 string
 * other arrays, struct/tuple: encoded as JSON arrays
 * dict: encoded as a JSON object, if the dict has string keys then those
   are used as property names directly, otherwise the keys are JSON encoded and
   the resulting string is used as a property name.
 * variant: encoded as a JSON object with a "v" field containing a value
   and a "t" field containing a DBus type signature.

   {
       "v": "value",
       "t": "s"
   }

Payload: rest-json1
-------------------

REST as application/json requests and responses.

What normally would be an HTTP request is encoded in a JSON wrapper. See
cockpitrestjson.c or rest.js.

Additional "open" command options are needed to open a channel of this
payload type:

 * "unix": Open a channel with the given unix socket.
 * "port": Open a channel with the given TCP port on localhost.

Requests are encoded as JSON objects. These objects have the following
fields:

 * "cookie": A unique integer which identifies this request. It will
   be included in the response. Defaults to zero. If a cookie is
   reused, then a previous request with that cookie will be cancelled.
   See below for more information about cancelling of requests.
 * "method": The HTTP method. If omitted, the request does nothing
   (and no responses will be sent) except maybe cancelling a previous
   request with the same cookie.
 * "path": The HTTP path or resource. Required if "method" is given.
 * "body": JSON to be sent as the body of the HTTP request. It will
   be sent with the Content-Type application/json.
 * "poll": An optional JSON object which turns this request into
   a JSON poll. Currently it has an "interval" field, which is an
   integer of how often in milliseconds to poll. It also has a "watch"
   field with contains a cookie value of another (usually streaming)
   request to watch, when the other request changes, polls again.

Responses are encoded as JSON objects. These objects have the following
fields:

 * "cookie": The cookie number of the request.
 * "status": The HTTP status number.
 * "message" HTTP status message.
 * "complete": true when this is the last response for the request.
   If not present, or set to false, then more responses will follow
   at some point.
 * "body": JSON returned as the body of the response. If this is
   missing then no JSON was returned.

If the HTTP response body contains multiple JSON results, then these will
be returned as separate response messages.

To cancel a previous request, send a new request with the same
"cookie" value but without a "method" field.  The connection to the
unix socket or port on localhost that was used for the previous
request will be closed.  A cancelled request will not receive any
further responses, not even one to indicate that it has been
cancelled.

Payload: stream
---------------

Raw data is sent back and forth to a socket. See cockpitstream.c. The
boundaries of the messages are arbitrary, and depend on how the kernel
and socket buffer things.

If the channel is not binary, then non-UTF-8 data is forced into UTF-8
with a replacement character.

Additional "open" command options should be specified with a channel of
this payload type:

 * "unix": Open a channel with the given unix socket.
 * "batch": Batches data coming from the stream in blocks of at least this
   size. This is not a guarantee. After a short timeout the data will be
   sent even if the data doesn't match the batch size. Defaults to zero.
 * "spawn": Spawn a process and connect standard input and standard output
   to the channel. Should be an array of strings which is the process
   file path and arguments.

You can't specify both "unix" and "spawn" together. When "spawn" is set the
following options can be specified:

 * "directory": The directory to spawn the process in.
 * "error": If "spawn" is set, and "error" is set to "output", then stderr
   is included in the payload data. If "pty" is set then stderr is always
   included.
 * "environ": This is the environment for the new spawned process. If unset,
   then the environment is inherited from the cockpit-bridge.
 * "pty": Execute the command as a terminal pty.

Payload: fswatch1
-----------------

You will get a stream of change notifications for a file or a
directory.

The following options can be specified in the "open" control message:

 * "path": The path name to watch.  This should be an absolute path to
   a file or directory.

Each message on the stream will be a JSON object with the following
fields:

 * "event": A string describing the kind of change.  One of "changed",
   "deleted", "created", "attribute-changed", "moved", or "done-hint".

 * "path": The absolute path name of the file that has changed.

 * "other": The absolute path name of the other file in case of a "moved"
   event.

In case of an error, the channel will be closed.  In addition to the
usual "problem" field, the "close" control message sent by the server
might have the following additional fields:

 * "message": A string in the current locale describing the error.

Payload: fsdir1
---------------

A channel of this type lists the files in a directory and will watch
for further changes.

The following options can be specified in the "open" control message:

 * "path": The path name of the directory to watch.  This should be an
   absolute path.

The channel will send a number of JSON messages that list the current
content of the directory.  These messages have a "event" field with
value "present" and a "path" field that holds the (relative) name of
the file.  After all files have been listed a message with an "event"
field of "present-done" is sent.

Other messages on the stream signal changes to the directory, in the
same format as used by the "fswatch1" payload type.

In case of an error, the channel will be closed.  In addition to the
usual "problem" field, the "close" control message sent by the server
might have the following additional fields:

 * "message": A string in the current locale describing the error.

Payload: fsread1
----------------

Returns the contents of a file and its current 'transaction tag'.

The following options can be specified in the "open" control message:

 * "path": The path name of the file to read.

The channel will return the content of the file in one or more
messages.  As with "stream", the boundaries of the messages are
arbitrary.

If the file is modified while you are reading it, the channel is
closed with a "change-conflict" problem code.  If the file is
atomically replaced as with 'rename' when you are reading it, this is
not considered an error and you will get the old content with a
correct tag.

When all content has been sent or an error has occurred, the channel
will be closed.  In addition to the usual "problem" field, the "close"
control message sent by the server might have the following additional
fields:

 * "message": A string in the current locale describing the error.

 * "tag": The transaction tag for the returned file content.  The tag
   for a non-existing file is "-".

Payload: fswrite1
-----------------

Replace the content of a file.

The following options can be specified in the "open" control message:

 * "path": The path name of the file to replace.

 * "tag": The expected transaction tag of the file.  When the actual
   transaction tag of the file is different, the write will fail.  If
   you don't set this field, the actual tag will not be checked.  To
   express that you expect the file to not exist, use "-" as the tag.

You should write the new content to the channel as one or more
messages.  To indicate the end of the content, close the channel
without a problem code.

If you don't send any content messages before closing the channel, the
file will be removed.  To create an empty file, send at least one
content message of length zero.

When the file does not have the expected tag, the channel will be
closed with a "change-conflict" problem code.

The new content will be written to a temporary file and the old
content will be replaced with a "rename" syscall when the channel is
closed without problem code.  If the channel is closed with a problem
code (by either client or server), the file will be left untouched.

In addition to the usual "problem" field, the "close" control message
sent by the server might have the following additional fields:

 * "message": A string in the current locale describing the error.

 * "tag": The transaction tag of the new content.

Problem codes
-------------

These are problem codes for errors that cockpit-web responds to. They should
be self explanatory. It's totally not interesting to arbitrarily invent new
codes. Instead the web needs to be ready to react to these problems. When in
doubt use "internal-error".

 * "internal-error"
 * "no-cockpit"
 * "no-session"
 * "not-authorized"
 * "not-found"
 * "terminated"
 * "timeout"
 * "unknown-hostkey"
 * "no-forwarding"
