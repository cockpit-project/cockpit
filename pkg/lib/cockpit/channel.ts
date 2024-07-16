/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { JsonObject } from './_internal/common';
import { Transport, ensure_transport, transport_globals } from './_internal/transport';
import { EventEmitter } from './event';

export type ChannelPayload = string | Uint8Array;

export interface BaseChannelOptions extends JsonObject {
    command?: never;
    channel?: never;
    binary?: boolean;
    host?: string;
    payload?: string;
    superuser?: "try" | "require";
}

export interface BinaryChannelOptions extends BaseChannelOptions {
    binary: true;
}

export interface TextChannelOptions extends BaseChannelOptions {
    binary?: false;
}

export type ChannelOptions<P extends ChannelPayload> =
    P extends Uint8Array ?
        BinaryChannelOptions
    : P extends string ?
        TextChannelOptions | undefined | void
    :
        BaseChannelOptions
    ;

type ChannelOpenOptions<P extends ChannelPayload> = ChannelOptions<P> & {
    payload: string;
};

export interface ChannelControlMessage extends JsonObject {
    command: string;
}

interface ChannelEvents<P extends ChannelPayload = string> {
    control(options: ChannelControlMessage): void;
    done(options: ChannelControlMessage): void;
    ready(options: ChannelControlMessage): void;
    close(options: ChannelControlMessage): void;
    data(data: P): void;
}

export class Channel<out P extends ChannelPayload = string> extends EventEmitter<ChannelEvents<P>> {
    id: string | null = null; // can be unassigned during transport startup
    readonly options: ChannelOpenOptions<P>;
    readonly binary: boolean;

    #transport: Transport | null = null;
    #received: Partial<Record<"close" | "ready" | "done", ChannelControlMessage>> = {};
    #queue: ([true, ChannelControlMessage] | [false, P])[] = [];
    #sent_done: boolean = false;

    #on_control(control: ChannelControlMessage): void {
        const command = control.command;

        if (command === 'ready' || command === 'close' || command === 'done') {
            if (this.#received[command]) {
                console.error('received duplicate control message', this.id, this.options, control);
                return;
            }

            this.#received[command] = control;
            this.emit(command, control);
        } else {
            this.emit('control', control);
        }

        if (command === 'close') {
            if (this.#transport && this.id)
                this.#transport.unregister(this.id);
            if (control.message && !this.options?.err)
                console.warn('channel error', control.message, this.id, this.options);
        }
    }

    /**
     * Open a new channel to the bridge.
     *
     * @options: The options for the channel.  A payload type must be specified.
     */
    constructor(options: ChannelOpenOptions<P>) {
        super();

        this.options = { ...options };
        this.binary = (options?.binary === true);

        ensure_transport(transport => {
            if (this.#received.close)
                return;

            this.#transport = transport;
            this.id = transport.next_channel();
            transport.register(
                this.id,
                control => {
                    if (typeof control.command !== 'string') {
                        console.error('Received control message without command', this.id, this.options, control);
                    } else {
                        this.#on_control(control as ChannelControlMessage);
                    }
                },
                data => {
                    if (this.binary && typeof data === 'string') {
                        console.error('Text message received on binary channel', this.id, this.options, data);
                    } else if (!this.binary && typeof data !== 'string') {
                        console.error('Binary message received on text channel', this.id, this.options, data);
                    } else {
                        this.emit('data', data as P);
                    }
                }
            );

            // We need to delay sending the open message until after we have
            // the transport because we need to set the host field.

            // Make a copy so we can modify some fields.
            const command: JsonObject = { ...this.options };

            if (!command.host && transport_globals.default_host) {
                command.host = transport_globals.default_host;
            }

            if (this.binary) {
                command.binary = "raw";
            } else {
                delete command.binary;
            }

            // Go direct: we need this to go before the rest of the queue
            transport.send_control({ ...command, command: 'open', channel: this.id, 'flow-control': true });

            // Now send everything else from the queue
            for (const [is_control, message] of this.#queue) {
                if (is_control) {
                    transport.send_control({ ...message, channel: this.id });
                } else {
                    transport.send_message(message, this.id);
                }
            }
            this.#queue = [];
        });
    }

    /**
     * Sends a payload frame.
     *
     * You may not call this after you've sent a 'done' control message or
     * after the channel has been closed.  This implies that you need to
     * register a 'close' event handler, and stop sending data after it's
     * called.
     *
     * @message the payload to send, either a string or a Uint8Array.
     */
    send_data(message: P): void {
        if (this.#sent_done) {
            console.error('sending data after .done()', this.id, this.options, message);
        } else if (this.#received.close) {
            console.error('sending data after close', this.id, this.options, message);
        } else if (this.#transport && this.id) {
            this.#transport.send_message(message, this.id);
        } else {
            this.#queue.push([false, message]);
        }
    }

    /**
     * Sends a control message on the channel.
     *
     * You may not call this after the channel is closed.  This implies that
     * you need to register a 'close' event handler, and stop sending data
     * after it's called.
     *
     * @options: the message to send.  A command must be specified.
     */
    send_control(options: ChannelControlMessage): void {
        if (this.#received.close) {
            console.error('sending control after close', this.id, this.options, options);
            return;
        }

        // A sent close message gets handled as if the exact same close message
        // was received.  This allows signalling your own code for cancellation, etc.
        if (options.command === 'close') {
            this.#on_control(options);
        } else if (options.command === 'done') {
            this.#sent_done = true;
        }

        if (this.#transport && this.id) {
            this.#transport.send_control({ ...options, channel: this.id });
        } else {
            this.#queue.push([true, options]);
        }
    }

    /**
     * Sends a done control message on the channel.  This is something like
     * EOF: it means that you won't send any more data using `.send_data()`.
     *
     * @options: optional extra arguments for the message.
     */
    done(options?: JsonObject): void {
        this.send_control({ ...options, command: 'done' });
    }

    /**
     * Closes the channel.
     *
     * This means that you're completely finished with the channel.  Any
     * underlying resources will be freed as soon as possible.  When you call
     * this you'll receive a 'close' signal (synchronously) and then nothing
     * else.
     *
     * @problem: a problem code.  If this is unset it implies something like a
     * "successful" close.  Otherwise, it indicates an error.
     * @options: the bridge will ignore this, but it will be thrown as the
     * result of any pending wait() operations and passed to the 'close' signal
     * handler, so you can use it to communicate with your own code.
     */
    close(problem?: string, options?: JsonObject): void {
        if (!this.#received.close) {
            this.send_control({ ...options, ...problem && { problem }, command: 'close' });
        }
    }

    /**
     * Waits for the result of the channel open request.
     *
     * @return: the content of the ready message, on success
     * @throws: the content of the close message, on fail
     */
    wait(): Promise<JsonObject> {
        return new Promise((resolve, reject) => {
            // If we got ready and closed then it's not an error.
            // Resolve with the ready message.
            if (this.#received.ready) {
                resolve(this.#received.ready);
            } else if (this.#received.close) {
                reject(this.#received.close);
            } else {
                this.on('ready', resolve);
                this.on('close', reject);
            }
        });
    }

    /**
     * Provides a text description of the channel.
     */
    toString(): string {
        const state =
            (!this.id && 'waiting for transport') ||
            (this.#received.close?.problem && `${this.id} error ${this.#received.close.problem}`) ||
            (this.#received.close && `${this.id} closed`) ||
            (this.#received.ready && `${this.id} opened`) ||
            `${this.id} waiting for open`;

        const host = this.options?.host || "localhost";

        return `[Channel ${state} -> ${this.options?.payload}@${host}]`;
    }
}
