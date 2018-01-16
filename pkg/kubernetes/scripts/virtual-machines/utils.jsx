/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

export const NODE_LABEL = 'kubevirt.io/nodeName';
export const VM_UID_LABEL = 'kubevirt.io/vmUID';

/**
 * @return {Array<{key: *, value: *}>} all own enumerable key-value pairs
 */
export function getPairs(object) {
    return Object.keys(object).map(key => ({
        key,
        value: object[key]
    }))
}

export function vmIdPrefx(vm) {
  return `vm-${vm.metadata.name}`
}

// TODO: set log level, i.e. reuse window.debug
export function logDebug(...args) {
  console.debug('Kubevirt: ', ...args);
}

export function mouseClick(fun) {
    return function (event) {
        if (!event || event.button !== 0)
            return;
        event.preventDefault();
        return fun(event);
    };
}

/**
 * Used to get sub-property value.
 *
 * Example:
 *   getValueOrDefault(() => myObj.foo.bar, defaultValue) returns value of myObj.foo.bar if path exists or default otherwise
 *
 */
export function getValueOrDefault(accessor, defaultValue) {
    try {
        let result = accessor();
        if (typeof result === 'undefined') {
            result = defaultValue;
        }
        return result;
    } catch (error) {
        if (!(error instanceof TypeError)) {
            throw error;
        }
    }
    return defaultValue;
}

export function preventDefault(e) {
    e.preventDefault();
    return false;
}

