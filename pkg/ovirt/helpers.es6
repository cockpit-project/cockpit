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
import cockpit from 'cockpit';

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
    return (value === undefined || value === null) ? def : value;
}

export function isNumeric(value) {
    return /^\d+$/.test(value);
}

/**
 * "Month Number Hour:Minute" (ie. September 17 18:15)
 * or "August 12, 2016 20:15" if the year is different from actual
 */
export function formatDateTime (milliseconds) {
    const now = new Date(); // Should be server time (not browser), but do we care for decision about the year difference?
    const date = new Date(milliseconds);
    const isYearDifferent = (now.getUTCFullYear() - date.getUTCFullYear()) !== 0;

    if (isNaN(date.getTime())) {
        return ''; // invalid date
    }

    const options = {
        month: 'long',
        year: isYearDifferent ? 'numeric' : undefined,
        day: 'numeric',
        hour: 'numeric',
        hour12: false,
        minute: 'numeric',
    };

    let localeString = date.toLocaleString(cockpit.language || 'en', options);
    localeString = localeString.replace(/,([^,]*)$/, '$1'); // remove ',' before time
    return localeString;
}
