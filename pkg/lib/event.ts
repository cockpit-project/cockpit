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
