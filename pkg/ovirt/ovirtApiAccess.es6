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

import CONFIG, { PEM_FILE } from './config.es6';
import { logDebug, logError } from '../machines/helpers.es6';
import { redirectToOvirtSSO } from './configFuncs.es6';

let httpClient = null;

/**
 * Reusable Http Client to access oVirt API.
 * @returns {*}
 */
function getHttpClient () {
    if (!httpClient) {
        httpClient = cockpit.http({
            "port": CONFIG.OVIRT_PORT,
            "address": CONFIG.OVIRT_FQDN,
            "tls": {
                "authority": {
                    "file": PEM_FILE
                },
                "key": {
                    "file": PEM_FILE
                },
                "certificate": {
                    "file": PEM_FILE
                }
            }
        });
    }

    return httpClient;
}

// TODO: use "Filter: true" header for non-admins
export function ovirtApiGet (resource, custHeaders, failHandler) {
    const headers = Object.assign({}, {
            'Accept': 'application/json',
            'Content-Type': 'application/xml', // TODO: change to JSON once verified
            'Authorization': 'Bearer ' + CONFIG.token
        },
        custHeaders);

    const url = `/ovirt-engine/api/${resource}`;
    logDebug(`ovirtApiGet(): resource: ${resource}, headers: ${JSON.stringify(headers)}, url: ${url}`);

    return getHttpClient().get(url, null, headers)
        .fail(function (exception, error) {
            console.info(`HTTP GET failed: ${JSON.stringify(error)}, ${JSON.stringify(exception)}, url: `, url);
            handleOvirtError({ error, exception, failHandler });
        });
}

export function ovirtApiPost (resource, body, failHandler) {
    logDebug(`ovirtApiPost(): resource: ${resource}, body: ${body}`);

    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/xml',
        'Authorization': 'Bearer ' + CONFIG.token,
    };

    const url = `/ovirt-engine/api/${resource}`;
    return getHttpClient().request({
        method: 'POST',
        path: url,
        headers,
        body,
    }).fail(function (exception, error) {
        console.info(`HTTP POST failed: ${JSON.stringify(error)}`, url);
        handleOvirtError({ error, exception, failHandler });
    });
}

export function handleOvirtError ({ error, exception, failHandler }) {
    if (!error) {
        logError(`oVirt operation failed but no error received`);
        return ;
    }

    console.info('handleOvirtError, error = ', error, 'exception = ', exception);

    if (!exception) {
        logError(`oVirt operation failed but no exception received`);
        return ;
    }

    switch (exception.status) {
        case 401: { // Unauthorized
            // clear token from sessionStorage and refresh --> SSO will pass again
            window.sessionStorage.setItem('OVIRT_PROVIDER_TOKEN', undefined); // see login.js
            redirectToOvirtSSO();
            return ; // never comes here
        }
        case 404: /* falls through */
        default:
            if (failHandler) {
                try { // returned error might be JSON-formatted
                    error = JSON.parse(error);
                } catch (ex) {
                    logDebug('handleOvirtError(): error is not a JSON string');
                }

                let data = error;
                if (error.detail) {
                    data = error.detail;
                } else if (error.fault) {
                    data = error.fault.detail || error.fault;
                }

                failHandler({ data, exception });
            } else {
                logError(`oVirt operation failed but no failHandler defined. Error: ${JSON.stringify(error)}`);
            }
    }
}

/**
 * Issue general-purpose HTTP GET.
 * Please use oVirtApiGet() to access the API instead.
 */
export function httpGet(address, port, resource) {
    console.info('httpGet(): ', address, port, resource);
    return cockpit.http({
        "port": parseInt(port),
        "address": address,
        "tls": {
            "authority": {
                "file": PEM_FILE
            },
            "key": {
                "file": PEM_FILE
            },
            "certificate": {
                "file": PEM_FILE
            }
        }
    }).get(resource);
}
