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
export class ParentWebSocket {
    binaryType = 'arraybuffer' as const; // compatibility with Transport, which sets this
    readyState = 0;

    // essentially signal handlers: these are assigned to from Transport
    onopen(): void {
    }

    onclose(): void {
    }

    onmessage(_event: MessageEvent): void {
    }

    constructor(parent: Window) {
        window.addEventListener("message", event => {
            if (event.origin !== transport_origin || event.source !== parent)
                return;
            const data = event.data;
            if (data === undefined || (data.length === undefined && data.byteLength === undefined))
                return;
            if (data.length === 0) {
                this.readyState = 3;
                this.onclose();
            } else {
                this.onmessage(event);
            }
        }, false);

        window.setTimeout(() => {
            this.readyState = 1;
            this.onopen();
        }, 0);
    }

    // same types as the real WebSocket
    send(message: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        parent.postMessage(message, transport_origin);
    }

    close(): void {
        this.readyState = 3;
        parent.postMessage("", transport_origin);
        this.onclose();
    }
}
