import { transport_origin } from './location';

/*
 * A WebSocket that connects to parent frame. The mechanism
 * for doing this will eventually be documented publicly,
 * but for now:
 *
 *  * Forward raw cockpit1 string protocol messages via window.postMessage
 *  * Listen for cockpit1 string protocol messages via window.onmessage
 *  * Never accept or send messages to another origin
 *  * An empty string message means "close" (not completely used yet)
 */
export function ParentWebSocket(parent) {
    const self = this;
    self.readyState = 0;

    window.addEventListener("message", function receive(event) {
        if (event.origin !== transport_origin || event.source !== parent)
            return;
        const data = event.data;
        if (data === undefined || (data.length === undefined && data.byteLength === undefined))
            return;
        if (data.length === 0) {
            self.readyState = 3;
            self.onclose();
        } else {
            self.onmessage(event);
        }
    }, false);

    self.send = function send(message) {
        parent.postMessage(message, transport_origin);
    };

    self.close = function close() {
        self.readyState = 3;
        parent.postMessage("", transport_origin);
        self.onclose();
    };

    window.setTimeout(function() {
        self.readyState = 1;
        self.onopen();
    }, 0);
}
