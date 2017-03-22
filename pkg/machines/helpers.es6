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
import cockpit from 'cockpit';
import VMS_CONFIG from './config.es6';

const _ = cockpit.gettext;

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

export function toKiloBytes(amount, currentUnit) {
    let result;
    switch (currentUnit) {
        case 'B':
            result = amount / 1024;
            break;
        case 'KiB':
            result = amount;
            break;
        case 'MiB':
            result = amount * 1024;
            break;
        case 'GiB':
            result = amount * 1024;
            break;
        default:
            console.error(`toKiloBytes(): unknown unit: ${currentUnit}`);
            result = amount / 1;
    }

    return result;
}

export function isEmpty(str) {
    return (!str || 0 === str.length);
}

export function arrayEquals(arr1, arr2) {
    if (arr1.length !== arr2.length) {
        return false;
    }

    const diff = arr1.filter((v, index) => {
        return v !== arr2[index];
    });
    return diff.length === 0;
}

export function logDebug(msg) {
    if (VMS_CONFIG.isDev) {
        console.log(msg);
    }
}

const transform = {
    'autostart': {
        'disable': _("disabled"),
        'enable': _("enabled"),
    },
    'connections': {
        'system': _("System"),
        'session': _("Session"),
    },
    'vmStates': {
        'running': _("running"),
        'idle': _("idle"),
        'paused': _("paused"),
        'shutdown': _("shutdown"),
        'shut off': _("shut off"),
        'crashed': _("crashed"),
        'dying': _("dying"),
        'pmsuspended': _("suspended (PM)"),
    },
    'bootableDisk': {
        'disk': _("disk"),
        'cdrom': _("cdrom"),
        'interface': _("network"),
        'hd': _("disk"),
    },
    'cpuMode': {
        'custom': _("custom"),
        'host-model': _("host"),
    },
};

export function rephraseUI(key, original) {
    if (!(key in transform)) {
        logDebug(`rephraseUI(key='${key}', original='${original}'): unknown key`);
        return original;
    }

    if (!(original in transform[key])) {
        logDebug(`rephraseUI(key='${key}', original='${original}'): unknown original value`);
        return original;
    }

    return transform[key][original];
}

export function toFixedPrecision(value, precision) {
    precision = precision || 0;
    const power = Math.pow(10, precision);
    const absValue = Math.abs(Math.round(value * power));
    let result = (value < 0 ? '-' : '') + String(Math.floor(absValue / power));

    if (precision > 0) {
        const fraction = String(absValue % power);
        const padding = new Array(Math.max(precision - fraction.length, 0) + 1).join('0');
        result += '.' + padding + fraction;
    }
    return result;
}
