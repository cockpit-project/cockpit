/*
 * Copyright (C) 2024 Red Hat, Inc.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export class EventEmitter<EM extends { [E in keyof EM]: (...args: never[]) => void }> {
    #listeners: { [E in keyof EM]?: EM[E][] } = {};

    public on<E extends keyof EM>(event: E, listener: EM[E]) {
        const listeners = this.#listeners[event] ||= [];
        listeners.push(listener);
        return () => {
            listeners.splice(listeners.indexOf(listener), 1);
        };
    }

    protected emit<E extends keyof EM>(event: E, ...args: Parameters<EM[E]>) {
        for (const listener of this.#listeners[event] || []) {
            listener(...args);
        }
    }
}
