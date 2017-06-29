/*jshint esversion: 6 */
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

export function getHostAddress() {
    const localHost = window.location.host;
    const localAddress = localHost.substring(0, localHost.indexOf(':'));
    return localAddress;
}

export function isSameHostAddress(hostAddress) {
    return getHostAddress() === hostAddress;
}

export function toGigaBytes(amount, currentUnit) {
    let result;
    switch (currentUnit) {
        case 'B':
            result = amount / 1024 / 1024 / 1024;
            break;
        case 'KiB':
            result = amount / 1024 / 1024;
            break;
        default:
            console.error(`toGigaBytes(): unknown unit: ${currentUnit}`);
            result = amount / 1;
    }

    if (result < 1) {
        result = result.toFixed(2);
    } else {
        const fixed1 = result.toFixed(1);
        result = (result - fixed1 === 0) ? result.toFixed(0) : fixed1;
    }

    return result;
}

export function valueOrDefault(value, def) {
    return (value === undefined || value === null) ?  def : value;
}

export function isNumeric(value) {
    return /^\d+$/.test(value);
}

