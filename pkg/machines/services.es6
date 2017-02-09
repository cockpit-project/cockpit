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
import { logDebug } from './helpers.es6';

export function spawnProcess({ cmd, args = [], stdin}) {
    const spawnArgs = [cmd, ...args];
    logDebug(`spawn process args: ${spawnArgs}`);

    return spawn(cockpit.spawn(spawnArgs, { superuser: "try", err: "message" })
        .input(stdin))
        .fail((ex, data) =>
            console.error(`spawn '${cmd}' process error: "${JSON.stringify(ex)}", data: "${JSON.stringify(data)}"`));
}

export function spawnScript({ script }) {
    const spawnArgs = [script];
    logDebug(`spawn script args: ${spawnArgs}`);

    return spawn(cockpit.script(spawnArgs, [], { err: "message" }))
        .fail((ex, data) =>
            console.error(`spawn '${script}' script error: "${JSON.stringify(ex)}", data: "${JSON.stringify(data)}"`));
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
