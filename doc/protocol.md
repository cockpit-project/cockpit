
Protocol Documentation
======================

The protocol is an implementation detail of Cockpit. It's a simple wrapper over
some other protocols, like DBus, REST, and so on. Use those instead.

Don't use this. This document ends here. It will self-destruct within 10
seconds. Leave now while you still can.

Channels
--------

Each message is part of a channel, which has a number. This channel number
identifies the type of data in the message payload, the host where it is
headed to/from and things like the service or user credentials.

Channel zero is a special channel called the control channel. It contains
command messages. These are described below. Initially only the control
channel exists. Additional channels are opened and closed via command
messages.

Channels operate across all participants, and they help the cockpit-ws
forwarding layer to know where to send messages.

The maximum channel number is 4294967294.

Framing
-------

The channel number is an integer in decimal as a string, and ends with a newline.
After this comes the channel dependent payload.

For example if you had a payload of the string 'abc', and it was being
sent through the channel 2, that might look like:

    2\nabc

When a message is sent over a stream transport that does not have distinct
messages (such as SSH or stdio), the message is also prefixed with a 32-bit MSB
length in bytes of the message. The length does not include the 4 bytes
of the length itself.

An example. When going over a stream transport with a payload of the 3 byte
string 'abc', and a channel of 2, would have a message length of 5: 3 bytes of
payload, 1 bytes for the channel number, 1 for the new line. It would look like
this on the wire:

    |----msb length---| |-chan--| |---payload--|
    0x05 0x00 0x00 0x00 0x32 0x0A 0x61 0x62 0x63

Once again, note that the channel number is ASCII digits followed by an ASCII
newline.

Command Messages
----------------

Command messages let the various components such as cockpit-web, cockpit-ws and
cockpit-agent communicate about what's going on.

Command messages are always sent in the control channel. They always have a
channel number of zero. The payload of a control message is always a json
object. There is always a "command" field:

    {
        "command": <command>,
        "channel": <channel>,
        ...
    }

If a command message pertains to a specific channel it has a "channel" field
containing the decimal number of the channel.

Unknown command messages are ignored, and forwarded as appropriate.

Command: open
-------------

The "open" command opens a new channel for payload.

The following fields are defined:

 * "channel": A uniquely chosen channel number in decimal
 * "payload": A payload type, see below
 * "host": The destination host for the channel, defaults to "localhost"
 * "user": Optional alternate user for authenticating with host
 * "password": Optional alternate password for authenticating with host

After the command is sent, then the channel is assumed to be open. No response
is sent. If for some reason the channel shouldn't or cannot be opened, then
the recipient will respond with a "close" message.

The channel number must not already be in use by another channel.

An example of an open:

    {
        "command": "open",
        "channel": 5,
        "payload": "dbus-json1",
        "host": "localhost"
    }

This message is sent from the cockpit-web frontend.

Command: close
--------------

The "close" command closes a channel or more channels.

The following fields are defined:

 * "channel": The decimal number of the channel to close
 * "reason": A short reason code for closure, or empty for a normal close

If the channel is not set, then all channels (that the recipient of the message
is aware of) will be closed.

An example of a close:

    {
        "command": "close",
        "channel" : 5,
        "reason": "not-authorized"
    }

Any protocol participant can send this message. The cockpit-agent and cockpit-ws
backends will send this message when a channel closes whether because of an
error or a normal closure. The frontend cockpit-web will send this when it
wants to close a channel normally.

See below for a list of problem codes.

Command: ping
-------------

The "ping" command is simply a keep alive.

No additional fields are defined.

An example of a ping:

    {
        "command": "ping",
    }

Any protocol participant can send this message, but it is not responded to or
forwarded.

Payload: dbus-json1
-------------------

DBus messages are encoded in JSON payloads by cockpit-web, and decoded in
cockpit-agent. Contents not yet documented. See cockpitdbusjson.c or dbus.js.

Additional "open" command options are needed to open a channel of this
type:

 * "service": A service name of the DBus service to communicate with.
 * "object-manager": The object path of a o.f.DBus.ObjectManager whose
   interfaces and properties will be relayed.

Payload: text-stream
--------------------

Raw text is sent back and forth to a socket. See cockpittextstream.c. The
boundaries of the messages are arbitrary, and depend on how the kernel
and socket buffer things.

Non-UTF8 data is not supported.

Additional "open" command options should be specified with a channel of
this payload type:

 * "unix": Open a channel with the given unix socket.

Problem codes
-------------

These are problem codes for errors that cockpit-web responds to. They should
be self explanatory. It's totally not interesting to arbitrarily invent new
codes. Instead the web needs to be ready to react to these problems. When in
doubt use "internal-error".

 * "internal-error"
 * "no-agent"
 * "no-session"
 * "not-authorized"
 * "not-found"
 * "terminated"
 * "timeout"
 * "unknown-hostkey"
