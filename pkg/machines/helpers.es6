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
import VMS_CONFIG from './config.es6';

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

export function rephraseUI(key, original) {
    const transform = {
        'autostart': {
            'disable': 'disabled',
            'enable': 'enabled'
        }
    };

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

// --- VM state functions --
export function canReset(vmState) {
    return vmState == 'running' || vmState == 'idle' || vmState == 'paused';
}

export function canShutdown(vmState) {
    return canReset(vmState);
}

export function isRunning(vmState) {
    return canReset(vmState);
}

export function canRun(vmState) {
    return vmState == 'shut off';
}
