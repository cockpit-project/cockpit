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

export function toReadableNumber(number) {
    if (number < 1) {
        return number.toFixed(2);
    } else {
        const fixed1 = number.toFixed(1);
        return (number - fixed1 === 0) ? number.toFixed(0) : fixed1;
    }
}

export const units = {
    B: {
        name: "B",
        base1024Exponent: 0,
    },
    KiB: {
        name: "KiB",
        base1024Exponent: 1,
    },
    MiB: {
        name: "MiB",
        base1024Exponent: 2,
    },
    GiB: {
        name: "GiB",
        base1024Exponent: 3,
    },
    TiB: {
        name: "TiB",
        base1024Exponent: 4,
    },
    PiB: {
        name: "PiB",
        base1024Exponent: 5,
    },
    EiB: {
        name: "EiB",
        base1024Exponent: 6,
    },
};

const logUnitMap = {
    '0': units.B,
    '1': units.KiB,
    '2': units.MiB,
    '3': units.GiB,
    '4': units.TiB,
    '5': units.PiB,
    '6': units.EiB,
};

function getPowerOf1024(exponent) {
    return exponent === 0 ? 1 : Math.pow(1024, exponent);
}

function getLogarithmOfBase1024(value) {
    return value > 0 ? (Math.floor(Math.log(value) / Math.log(1024))) : 0;
}

export function convertToBestUnit(input, inputUnit) {
    return convertToUnitVerbose(input, inputUnit,
                                logUnitMap[getLogarithmOfBase1024(convertToUnitVerbose(input, inputUnit, units.B).value)]);
}

export function convertToUnit(input, inputUnit, outputUnit) {
    return convertToUnitVerbose(input, inputUnit, outputUnit).value;
}

export function convertToUnitVerbose(input, inputUnit, outputUnit) {
    let result = {
        value: 0,
        unit: units.B.name,
    };

    input = Number(input);
    if (isNaN(input)) {
        console.error('input is not a number');
        return result;
    }

    if (input < 0) {
        console.error(`input == ${input} cannot be less than zero`);
        return result;
    }

    let inUnit = units[(typeof inputUnit === 'string' ? inputUnit : inputUnit.name)];
    let outUnit = units[(typeof outputUnit === 'string' ? outputUnit : outputUnit.name)];

    if (!inUnit || !outUnit) {
        console.error(`unknown unit ${!inUnit ? inputUnit : outputUnit}`);
        return result;
    }

    let exponentDiff = inUnit.base1024Exponent - outUnit.base1024Exponent;
    if (exponentDiff < 0) {
        result.value = input / getPowerOf1024(-1 * exponentDiff);
    } else {
        result.value = input * getPowerOf1024(exponentDiff);
    }
    result.unit = outUnit.name;

    return result;
}

export function isEmpty(str) {
    return (!str || str.length === 0);
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

export function digitFilter(event, allowDots = false) {
    let accept = (allowDots && event.key === '.') || (event.key >= '0' && event.key <= '9') ||
                 event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Tab' ||
                 event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
                 event.key === 'ArrowUp' || event.key === 'ArrowDown' ||
                 event.key === 'Home' || event.key === 'End';

    if (!accept)
        event.preventDefault();

    return accept;
}

export function getTodayYearShifted(yearDifference) {
    const result = new Date();
    result.setFullYear(result.getFullYear() + yearDifference);
    return result;
}

const transform = {
    'autostart': {
        'disable': _("disabled"),
        'enable': _("enabled"),
        /* The following keys are used in LibvirtDBus provider */
        false: _("disabled"),
        true: _("enabled"),
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

/**
 * Download given content as a file in the browser
 *
 * @param data Content of the file
 * @param fileName
 * @param mimeType
 * @returns {*}
 */
export function fileDownload({ data, fileName = 'myFile.dat', mimeType = 'application/octet-stream' }) {
    if (!data) {
        console.error('fileDownload(): no data to download');
        return false;
    }

    const a = document.createElement('a');
    a.id = 'dynamically-generated-file';
    a.href = `data:${mimeType},${encodeURIComponent(data)}`;
    document.body.appendChild(a); // if not used further then at least within integration tests

    // Workaround since I can't get CSP working for this
    /*
    if ('download' in a) { // html5 A[download]
        logDebug('fileDownload() is using A.HREF');
        a.setAttribute('download', fileName);
        a.click();
    } else */ { // do iframe dataURL download
        logDebug('fileDownload() is using IFRAME');
        const f = document.createElement('iframe');
        f.width = '1';
        f.height = '1';
        document.body.appendChild(f);
        const nicerText = '\n[...............................GraphicsConsole]\n';
        f.src = `data:${mimeType},${encodeURIComponent(data + nicerText)}`;
        window.setTimeout(() => document.body.removeChild(f), 333);
    }

    window.setTimeout(() => { // give test browser some time ...
        logDebug('removing temporary A.HREF for filedownload');
        document.body.removeChild(a);
    }, 5000);
    return true;
}

export function vmId(vmName) {
    return `vm-${vmName}`;
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
 * Let promise resolve itself in specified delay or force resolve it with 0 arguments
 *
 * @param promise
 * @param delay of timeout in ms
 * @param afterTimeoutHandler called only if promise succeeded after timeout
 * @param afterTimeoutFailHandler called only if promise failed after timeout
 * @returns new promise
 */
export function timeoutedPromise(promise, delay, afterTimeoutHandler, afterTimeoutFailHandler) {
    const deferred = cockpit.defer();
    let done = false;

    let timer = window.setTimeout(() => {
        if (!done) {
            deferred.resolve();
            done = true;
        }
    }, delay);

    promise.then(function(/* ... */) {
        if (!done) {
            done = true;
            window.clearTimeout(timer);
            deferred.resolve.apply(deferred, arguments);
        } else if (typeof afterTimeoutHandler === 'function') {
            afterTimeoutHandler.apply(afterTimeoutFailHandler, arguments);
        }
    });

    promise.catch(function(/* ... */) {
        if (!done) {
            done = true;
            window.clearTimeout(timer);
            deferred.reject.apply(deferred, arguments);
        } else if (typeof afterTimeoutFailHandler === 'function') {
            afterTimeoutFailHandler.apply(afterTimeoutFailHandler, arguments);
        }
    });

    return deferred.promise;
}
