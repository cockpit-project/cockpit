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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from 'cockpit';

// These are the same values used by the bridge (in channel.py)
const BLOCK_SIZE = 16 << 10; // 16kiB
const FLOW_WINDOW = 2 << 20; // 2MiB

function debug(...args: unknown[]) {
    if (window.debugging == 'all' || window.debugging?.includes('upload'))
        console.debug('upload', ...args);
}

class UploadError extends Error {
    name = 'UploadError';
}

class Waiter {
    unblock = () => { };
    block(): Promise<void> {
        return new Promise(resolve => { this.unblock = resolve });
    }
}

export async function upload(
    destination: string,
    contents: Blob,
    progress?: (bytes_sent: number) => void,
    signal?: AbortSignal,
    options?: cockpit.JsonObject
) {
    let close_message = null as (cockpit.JsonObject | null);
    let outstanding = 0; // for flow control
    let delivered = 0; // for progress reporting

    // This variable is the most important thing in this function.  The main
    // upload loop will do work for as long as it can, and then it .block()s on
    // the waiter until something changes (ack, close, abort, etc).  All of
    // those things call .unblock() to resume the loop.
    const event_waiter = new Waiter();

    if (signal) {
        signal.throwIfAborted(); // early exit
        signal.addEventListener('abort', event_waiter.unblock);
    }

    const opts = {
        payload: 'fsreplace1',
        path: destination,
        binary: true,
        size: contents.size,
        'send-acks': 'bytes',
        ...options,
    } as const;
    debug('requesting channel', opts);
    const channel = cockpit.channel(opts);
    channel.addEventListener('control', (_ev, message) => {
        debug('control', message);
        if (message.command === 'ack') {
            cockpit.assert(typeof message.bytes === 'number', 'bytes not a number');
            delivered += message.bytes;
            if (progress) {
                debug('progress', delivered);
                progress(delivered);
            }
            outstanding -= message.bytes;
            debug('outstanding -- to', outstanding);
            event_waiter.unblock();
        }
    });
    channel.addEventListener('close', (_ev, message) => {
        debug('close', message);
        close_message = message;
        event_waiter.unblock();
    });

    try {
        debug('starting file send', contents);

        /* We want to use the "bring your own buffer" (byob) API so that we can
         * decide the size of the blocks to read from the file: this is needed
         * for flow control reasons and also to respect internal limitations in
         * cockpit-ws.  "byob" is not available on WebKit, though:
         *
         *    https://caniuse.com/mdn-api_readablestreambyobreader
         *
         * Check if the API is available, and fake it if not.
         */
        let read;
        if (typeof ReadableStreamBYOBReader === 'function') {
            const reader = contents.stream().getReader({ mode: 'byob' });
            read = () => reader.read(new Uint8Array(BLOCK_SIZE));
        } else {
            // fallback code (no 'byob' available)
            const reader = contents.stream().getReader();
            let buffer: Uint8Array | null = null;
            read = async () => {
                // No buffered data?  Try a read.
                if (!buffer) {
                    const { done, value } = await reader.read();
                    if (done) {
                        return { done, value };
                    } else {
                        buffer = value;
                    }
                }

                // Return the buffered data: if length < size, return it all, else return a slice
                if (buffer.length < BLOCK_SIZE) {
                    const value = buffer;
                    buffer = null;
                    return { done: false, value };
                } else {
                    const value = buffer.slice(0, BLOCK_SIZE);
                    buffer = buffer.slice(BLOCK_SIZE);
                    return { done: false, value };
                }
            };
        }

        let eof = false;

        // eslint-disable-next-line no-unmodified-loop-condition
        while (!close_message) {
            /* We do the following steps for as long as the channel is open:
             *  - if there is room to write more data, do that
             *  - otherwise, block on the waiter until something changes
             *  - in any case, check for cancellation, repeat
             * The idea here is that each loop iteration will `await` one
             * thing, and once it returns, we need to re-evaluate our state.
             */
            if (!eof && outstanding < FLOW_WINDOW) {
                const { done, value } = await read();
                if (done) {
                    debug('sending done');
                    channel.control({ command: 'done' });
                    eof = true;
                } else {
                    debug('sending', value.length, 'bytes');
                    channel.send(value);
                    outstanding += value.length;
                    debug('outstanding ++ to', outstanding);
                }
                if (signal) {
                    signal.throwIfAborted();
                }
            } else {
                debug('sleeping', outstanding, 'of', FLOW_WINDOW, 'eof', eof);
                await event_waiter.block();
            }
            if (signal) {
                signal.throwIfAborted();
            }
        }

        if (close_message.problem) {
            throw new UploadError(cockpit.message(close_message));
        } else {
            cockpit.assert(typeof close_message.tag === 'string', "tag missing on close message");
            return close_message.tag;
        }
    } finally {
        debug('finally');
        channel.close(); // maybe we got aborted
    }
}
