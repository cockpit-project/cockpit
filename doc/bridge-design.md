# Internal documentation of cockpit-bridge

This document aims to describe the internal design decisions of
`cockpit-bridge` from the standpoint of someone who already has an
understanding of how Cockpit functions at a component level (ie: how the
protocol looks, what channels are, etc.).

`doc/protocol.md` describes the protocol itself in more detail.

First: a bit of terminology.  When written as "`Channel`", we're talking about
a specific instance of a subclass of the `Channel` type from `channel.py`. When
written as "channel", we're talking about the concept of a given named channel.
In this case, "channel id" refers to the name of that channel.

## Protocols and transports

The design of `cockpit-bridge` is based around the `asyncio.Protocol` and
`asyncio.Transport` approach.

The Cockpit wire protocol is implemented by an `asyncio.Protocol` subclass
named `CockpitProtocol, living in `protocol.py`.  It calls virtual methods on
itself in response to incoming messages.  Those methods all have names like
`transport_control_received()` or `channel_data_received()`, to match the
flavour of the `data_received()` and `eof_received()` methods on
`asyncio.Protocol`. Similarly, all methods for writing outgoing data are named
like `write_channel_data()` or `write_control()` to match the `write()` method
on `asyncio.Transport`.

## Router, endpoints, and routing rules.

The most relevant subclass of `CockpitProtocol` is `Router` — a protocol
implementation that responds to incoming messages by routing them to
`Endpoint`s.

This relationship between `Router` and `Endpoint` is most important internal
class relationship in the bridge. These two classes would be described as
"friends" in some languages.  They both live in `router.py` and reach inside of
each others implementation.  Neither of them makes any sense without the other.

A given `cockpit-bridge` process contains a single `Router` and potentially
many `Endpoint`s.  The two main `Endpoint` subclasses are `Channel` and `Peer`.

All messages sent through `cockpit-bridge` involve either the `Router`
forwarding incoming messages by calling one of the `do_` methods on an
`Endpoint` or a given `Endpoint` sending reply messages back to the client by
calling one of the `write_()` method on the `Router`.

All `Endpoint` objects refer back to the `Router` (from the instant they're
created) and the `Router` keeps track of all existing `Endpoint` objects.

`Router` maintains two main sets of state:

 - a mapping between open channel ids and the `Endpoint` responsible for
   serving them.  This is used to route incoming messages to the correct place.
   Entries are added in response to `Endpoint`s being returned from `RoutingRule`s
   (see below) and entries are removed in response to `close` messages from the
   `Endpoint`.

 - a mapping between all existing `Endpoint` objects and a set of channels ids
   which are open on them.  The `Endpoint`s are added to this table when
   they're created and the channel set is updated in lockstep with the above
   mapping.

These two mappings might seem to be redundant, but they allow for a very
important situation: the second mapping allows the `Router` to hold a reference
to an `Endpoint` even if there are zero open channels.  In that case. the set
of channel ids is empty.  In this sense, the second mapping contains strictly
more information than the first (even if the first one is the one which is used
on every incoming message).

An endpoint with zero channels routed to it may exist because it was requested,
but not currently in use by anything (common with `Peer`s) or because it's
currently trying to shutdown and all channels have been closed but there are
still outstanding tasks (happens with both `Peer` and `Channel`).

Important: in Python you need to take care to ensure that asynchronous
background tasks are properly cleaned up before dropping references to them.
The relationship between `Router` and `Endpoint`, even in the absence of routed
channels, allows `Endpoint`s to finish up their tasks without getting dropped.
The `Router` will hold a reference to each `Endpoint` until everything is
complete, and will even prevent the entire bridge from exiting until everything
has been cleaned up properly.

## Routing rules

The third class which is most closely related to `Router` and `Endpoint` is
definitely `RoutingRule`.

A `RoutingRule` looks at incoming `open` message and has the ability to return
an `Endpoint` to handle the requested channel.  Routing rules are responsible
for the creation of `Endpoint`s.  The `Router` maintains a (mostly) static list
of `RoutingRule`s which are consulted, in seqeunce, for each incoming `open`
message.

In general, there are several different routing rules which can return `Peer`s
and one special routing rule — `ChannelRoutingRule` — which creates `Channel`
instances according to the requested `payload` type on the `open` message.

Once a `RoutingRule` returns a given endpoint to handle a message, the router
adds a mapping from the channel id to the `Endpoint` to its routing table.

`RoutingRule`s can have a sort of "caching" relationship with their
`Endpoint`s, which is often the case for `Peer`s.  For example, once the
superuser bridge is brought online the `SuperuserRoutingRule` will remember the
`SuperuserPeer` instance and return the same one each time a superuser channel
is requested, rather than creating a new one.

The `RoutingRule` is not responsible for ensuring that the `Endpoint` is
properly shutdown before dropping its reference to it — that's the job of the
`Router`.  Indeed, a `RoutingRule` can be completely stateless (as is the case
for the `ChannelRoutingRule`).

`RoutingRule`s can sometimes close their cached `Peer`s.  This can happen, for
example:

 - if a routing rule created for a bridge described in a `manifest.json` file no
   longer exists after a reload then the associated bridge will be shutdown

 - if the client calls the `Stop` method on the `/superuser` D-Bus endpoint

 - if the client sends a `kill` message with `host=` set to the name of a given
   remote host

In this case, the `RoutingRule` can request the close and immediately drop its
reference — `Router` is responsible for waiting until the `Peer` is finished.

## Channels

A channel is a bi-directional ordered datagram transport between `cockpit.js`
and some piece of backend code (ie: a subclass of `Channel` inside of a bridge
running on some host).

A channel is only opened in response to an `open` control message from the
client.  A channel is closed when the `Channel` subclass sends a `close`
control message.  The client sending a `close` message does not close the
channel — it is considered to be a request from the client — although it will
usually be quickly followed by a corresponding `close` message from the
`Channel` implementation.

The Python bridge will always send either a `close` message (with `problem=`)
or a `ready` message in response to an `open` control message.  This is
different from the original implementation of the bridge in C, which would
sometimes open channels without sending any acknowledgement.

Inside the Python bridge, `Channel` is a subclass of `Endpoint` — it is an
endpoint which is responsible for a single channel.  Usually a single channel
is routed to the `Channel` object, but some `Channel`s which require a longer
time to shutdown may temporarily be in a state where no channels are routed to
them before they finish shutting down, as described above.
