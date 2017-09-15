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

export function logDebug(msg, ...params) {
    if (VMS_CONFIG.isDev) {
        console.log(msg, ...params);
    }
}

export function logError(msg, ...params) {
    console.error(msg, ...params);
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
    'networkType': {
        'direct': _("direct"),
        'network': _("network"),
        'bridge': _("bridge"),
        'user': _("user"),
        'ethernet': _("ethernet"),
        'hostdev': _("hostdev"),
        'mcast': _("mcast"),
        'server': _("server"),
        'udp': _("udp"),
        'vhostuser': _("vhostuser"),
    },
    'networkManaged': {
        'yes': _("yes"),
        'no': _("no"),
    },
    'networkState': {
        'up': _("up"),
        'down': _("down"),
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


function isFirefox () {
    return window.navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
}

/**
 * Download given content as a file in the browser
 *
 * @param data Content of the file
 * @param fileName
 * @param mimeType
 * @returns {*}
 */
export function fileDownload ({ data, fileName = 'myFile.dat', mimeType = 'application/octet-stream' }) {
    if (!data) {
        console.error('fileDownload(): no data to download');
        return false;
    }

    const a = document.createElement('a');
    a.id = 'dynamically-generated-file';
    a.href = `data:${mimeType},${encodeURIComponent(data)}`;
    document.body.appendChild(a); // if not used further then at least within integration tests

    // Workaround since I can't get CSP working on newer Firefox versions for this
    if (!isFirefox() && 'download' in a) { // html5 A[download]
        logDebug('fileDownload() is using A.HREF');
        a.setAttribute('download', fileName);
        a.click();
    } else { // do iframe dataURL download (old ch+FF):
        logDebug('fileDownload() is using IFRAME');
        const f = document.createElement('iframe');
        f.width = '1';
        f.height = '1';
        document.body.appendChild(f);
        const nicerText = '\n[...............................GraphicsConsole]\n';
        f.src = `data:${mimeType},${encodeURIComponent(data + nicerText)}`;
        window.setTimeout(() => document.body.removeChild(f), 333);
    }

    window.setTimeout(() => { // give phantomJS time ...
        logDebug('removing temporary A.HREF for filedownload');
        document.body.removeChild(a);
    }, 5000);
    return true;
}

export function vmId(vmName) {
    return `vm-${vmName}`;
}
