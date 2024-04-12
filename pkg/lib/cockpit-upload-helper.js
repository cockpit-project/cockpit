/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */
import cockpit from "cockpit";

const BLOCK_SIZE = 16 * 1024;
const TOTAL_FRAME_WINDOW = 128;

function UploadError(message = "", detail = "") {
    this.name = "UploadError";
    this.message = message;
    this.detail = detail;
}
UploadError.prototype = Error.prototype;

/*
 * Cockpit Upload helper - uploads a blob to the provided destination with an
 * optional progress callback using the fsreplace1 channel.
 *
 * Example usage:
 *
 * const helper = UploadHelper("/tmp/file.txt")
 * try {
 *   const status = await helper.upload(file);
 * } catch (exc) {
 * }
 *
 * Uploads can be cancelled while in progress by calling `helper.cancel`,
 * fsreplace1 will automatically clean up the temporary file.
 */
export class UploadHelper {
    constructor(destination, onProgress, options) {
        this.destination = destination;
        this.progressCallback = onProgress;
        this.outstanding = 0;

        // Promise resolvers
        this.resolveHandler = null;
        this.closeHandler = null;
        this.closeReject = null;
        this.close_message = null;

        options = options || {};
        this.channel = cockpit.channel({
            binary: true,
            payload: "fsreplace1",
            path: this.destination,
            "send-acks": "frames",
            ...options,
        });
        this.channel.addEventListener("control", this.on_control.bind(this));
        this.channel.addEventListener("close", this.on_close.bind(this));
    }

    // Private methods
    on_control(event, message) {
        if (message?.command === "ack") {
            this.outstanding -= message.frames;

            console.assert(this.outstanding >= 0, "outstanding went negative", this.outstanding);

            if (this.resolveHandler) {
                this.resolveHandler();
                this.resolveHandler = null;
            }
        }
    }

    on_close(event, message) {
        // Resolve an potential inflight ack
        if (this.resolveHandler)
            this.resolveHandler();

        // Keep track of a close message for exception handling
        this.close_message = message;

        if (message.problem) {
            this.closeReject(message);
        } else {
            this.closeHandler();
        }
    }

    write(chunk) {
        console.assert(this.outstanding >= 0, "ack outstanding went negative", this.outstanding);
        this.outstanding += 1;
        this.channel.send(chunk);

        if (this.outstanding < TOTAL_FRAME_WINDOW) {
            return Promise.resolve();
        } else {
            return new Promise((resolve, reject) => {
                this.resolveHandler = resolve;
            });
        }
    }

    wait_ready() {
        const channel = this.channel;
        return new Promise((resolve, reject) => {
            channel.addEventListener("ready", function(event, message) {
                resolve();
            });
        });
    }

    // Public methods

    // Flush is waiting on acks in flight
    async upload(file) {
        await this.wait_ready();
        const closePromise = new Promise((resolve, reject) => {
            this.closeHandler = resolve;
            this.closeReject = reject;
        });

        let chunk_start = 0;
        let send_chunks = 0;

        while (this.channel.valid && chunk_start <= file.size) {
            const chunk_next = chunk_start + BLOCK_SIZE;
            const blob = file.slice(chunk_start, chunk_next);

            const chunk = new Uint8Array(await blob.arrayBuffer());
            await this.write(chunk);

            send_chunks += blob.size;
            if (this.progressCallback)
                this.progressCallback(send_chunks);

            chunk_start = chunk_next;
        }

        if (this.channel.valid) {
            this.channel.control({command: 'done'});
            try {
                await closePromise;
            } catch (exc) {
                throw new Error(exc.toString());
            }
        } else if (this.close_message.problem) {
            throw new UploadError(cockpit.message(this.close_message.problem) || this.close_message.message, this.close_message.message);
        }
    }

    cancel() {
        // Automatically handles reject for us
        this.channel.close();
    }
}
