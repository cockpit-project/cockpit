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
import CONFIG from './config.es6';
import { rephraseClassName } from './rephrase.es6';

// --- compatibility hack for PhantomJS
/*
if (!String.prototype.includes) {
    String.prototype.includes = function(search, start) {
        if (typeof start !== 'number') {
            start = 0;
        }

        if (start + search.length > this.length) {
            return false;
        } else {
            return this.indexOf(search, start) !== -1;
        }
    };
}
*/
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

export function trim(str) {
    if (str) {
        return str.trim();
    }
    return str;
}

export function logDebug(msg) {
    if (CONFIG.isDev) {
        console.log(msg);
    }
}

export function logError(msg) {
    console.error(`ERROR: ${msg}`);
}

function spawn(command) {
    const deferred = cockpit.defer();
    let stdout = '';
    command
        .stream(chunk => {
            stdout += chunk;
        })
        .done(() => {
            deferred.resolve(stdout);
        })
        .fail((ex, data) => {
            deferred.reject(ex, data, stdout);
        });

    return deferred.promise;
}

export function spawnScript(script, failCallback) {
    script = `LANG=C && ${script}`;
    const spawnArgs = [script];
    logDebug(`spawn script args: ${spawnArgs}`);

    return spawn(cockpit.script(spawnArgs))
        .fail((ex, data) => {
            logError(`spawn '${script}' script error: "${JSON.stringify(ex)}", data: "${JSON.stringify(data)}"`);
            if (failCallback) {
                failCallback();
            }
        });
}

export function objectValues (obj) {
    return Object.keys(obj).map( key => obj[key] );
}

export function stringOrDefault (val, def) {
    return val === undefined ? def : String(val);
}

export function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function classNameSorter (arr) {
    const groupKeysComparator = (a, b) => {
        const lastKeyContains = 'Unclassified'; // keep english
        if (a === undefined || b === undefined) {
            logDebug(`classNameSorter: a=${a}, b=${b}`);
        }
        if (a.indexOf(lastKeyContains) >= 0) {
            return 999;
        }
        if (b.indexOf(lastKeyContains) >= 0) {
            return -999;
        }

        return rephraseClassName(a).localeCompare(rephraseClassName(b));
    };

    return arr.sort(groupKeysComparator);
}
