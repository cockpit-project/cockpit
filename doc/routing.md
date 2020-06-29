

Flow Control
------------

Cockpit's protocol passes messages on reliable, ordered underlying
transports (eg: WebSockets, HTTP responses, stdio) between multiple
peers, arranged in in a non-rooted tree graph.

Cockpit's flow control is not about replaying messages, but avoiding
flooding any peer by sending messages along any link in the graph
too rapidly.

Cockpit's flow control operates at the level of channels in the protocol
(described in doc/protocol.md). A simple blocking of any peer's message input
would block all channels, and not have the desired effect of slowing
down a certain channel which is flooding communication.

Therefore we use a windowing flow control protocol. It is based around
per-channel "ping" control messages. In the Cockpit protocol "ping"
messages in a channel are responded to by specific leaves of the graph.
They are replied to with a "pong" containing otherwise identical content.
Other "ping" messages are used as keep alives, but these are beyond the
scope of this description.

Each channel leaf that participates in flow control sends "ping"
messages with a sequence number, and waits to see the corresponding
"pong" message with the same sequence and channel number. By checking
the "ping" sequence numbers responded to, a channel can slow input and/or
transmission to wait for the opposite leaf to catch up.

Sadly this is not enough. The leaves in of Cockpit's tree often do not
consume data themselves, but pass it on to other sockets, streams, files
and so on.

Various leaves monitor their output edge queues and hold back responding
to "ping" messages if their output edge queue is too full. This is done
by use of "pressure" signals on the output queue to indicate when pressure
is high or low.

This results in flow control that achieves its intent, but does not
make guarantees. In addition only some channels and leaves implement flow
control at this point:

 * cockpit.js: Responds to "ping" messages indicating that a given
   sequence has reached the browser.

 * CockpitChannel: Sends sequence pings, every so often in the channel.
   Is responsible for responding to channel pings, and holding back
   responses to pings if a related queue has output "pressure".
   Slows down an input pipe via a "pressure" signal when too many
   sequences are outstanding and have not been responded to.

 * CockpitStream: Can listen to "pressure" signals and pause reading its
   input stream. Can generate "pressure" signals when its output queue
   is too full.

 * CockpitPipe: Can listen to "pressure" signals and pause reading its
   input file descriptor. Can generate "pressure" signals when its
   output queue is too full.

 * CockpitWebResponse: Can generate "pressure" signals when its output
   queue is too full.

 * WebSocketConnection: Can listen to "pressure" signals and pause accepting
   incoming web socket messages. Can generate "pressure" signals when its
   output queue is too full.

 * CockpitHttpStream: Uses CockpitStream and CockpitChannel together to
   implement flow control on a HTTP client connection.

 * CockpitFsRead: Listens to "pressure" signals from the CockpitChannel
   to tell it to pause reading a file.
