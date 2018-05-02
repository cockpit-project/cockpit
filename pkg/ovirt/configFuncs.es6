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

import { logDebug, logError } from '../machines/helpers.es6';
import CONFIG, { OVIRT_CONF_FILE, REQUIRED_OVIRT_API_VERSION, getOvirtBaseUrl } from './config.es6';
import MACHINES_CONFIG from '../machines/config.es6';
import { setOvirtApiCheckResult } from './provider.es6';
import { ovirtApiGet } from './ovirtApiAccess.es6';
import { startOvirtPolling } from './ovirt.es6';
import { loginInProgress, setHostname, setHostIPs } from './actions.es6';
import installationDialog from './components/InstallationDialog.jsx';

import store, { waitForReducerSubtreeInit } from './store.es6';

export function readConfiguration ({ dispatch }) {
    logDebug(`readConfiguration() called for configUrl='${OVIRT_CONF_FILE}'`);

    const promises = [];
    promises.push(doReadConfiguration({ dispatch }));
    promises.push(doReadHostname({ dispatch }));
    promises.push(doReadIpAddresses({ dispatch }));

    return cockpit.all(promises);
}

/**
 * Configuration can be changed by admin after installation
 * and is kept in separate file (out of manifest.json)
 * @param dispatch
 */
function doReadConfiguration ({ dispatch }) {
    const onCancel = () => {
        dispatch(loginInProgress(false));
    };

    // Configuration can be changed by admin after installation
    // and so is kept in separate file (out of manifest.json)
    return cockpit.file(OVIRT_CONF_FILE).read()
            .done((content) => {
                if (!content) {
                    console.info('Configuration file empty, post-installation setup follows to generate: ', OVIRT_CONF_FILE);
                    installationDialog({ onCancel });
                    return;
                }

                console.log(`Configuration file ${OVIRT_CONF_FILE} content is read ...`);
                const config = JSON.parse(content);
                console.log('... and parsed');
                Object.assign(CONFIG, config);

                MACHINES_CONFIG.isDev = CONFIG.debug;

                if (CONFIG.Virsh && CONFIG.Virsh.connections) {
                    MACHINES_CONFIG.Virsh = CONFIG.Virsh; // adjust pkg/machines
                    CONFIG.Virsh = null; // not used anywhere else within pkg/ovirt
                    logDebug('Connection params for virsh: ', JSON.stringify(MACHINES_CONFIG.Virsh));
                }

                logDebug(`Configuration parsed, using merged result: ${JSON.stringify(CONFIG)}`);
                return doLogin({ dispatch });
            })
            .fail(() => {
                console.info('Failed to read configuration, post-installation setup follows to generate: ', OVIRT_CONF_FILE);
                installationDialog({ onCancel });
            });
}

function storeSsoUri (location) {
    const accessTokenStart = location.href.lastIndexOf('access_token=');
    if (accessTokenStart >= 0) { // valid only if ovirt-cockpit-sso is involved
        const ssoUri = location.href.substr(0, accessTokenStart + 'access_token='.length);
        logDebug('storeSsoUri(): ', ssoUri);
        window.sessionStorage.setItem('OVIRT_PROVIDER_SSO_URI', ssoUri);
    }
}

function doReadHostname ({ dispatch }) {
    let hostname = '';
    return cockpit.spawn(['hostname', '-f'], {'err': 'message'})
            .stream(data => {
                hostname += data;
            })
            .done(() => {
                hostname = hostname.trim();
                logDebug('hostname read: ', hostname);
                waitForReducerSubtreeInit(() => dispatch(setHostname(hostname)));
            })
            .fail(ex => {
                console.error("Getting 'hostname' failed:", ex);
            });
}

function doReadIpAddresses ({ dispatch }) {
    let output = '';
    return cockpit.spawn(['hostname', '--all-ip-addresses'], {'err': 'message'})
            .stream(data => {
                output += data;
            })
            .done(() => {
                // space separated list
                const ips = output.split(' ');
                logDebug('host ip addresses: ', ips);
                waitForReducerSubtreeInit(() => dispatch(setHostIPs(ips)));
            })
            .fail(ex => {
                console.error("Getting list of host ip addresses failed:", ex);
            });
}

function doLogin ({ dispatch }) {
    logDebug('doLogin() called');

    const location = window.top.location;
    const tokenStart = location.hash.indexOf('token=');
    let token = window.sessionStorage.getItem('OVIRT_PROVIDER_TOKEN'); // as default

    logDebug(`location: '${location.toString()}'\ntokenStart='${tokenStart}'\ntoken='${token}'`);

    if (tokenStart >= 0) { // TOKEN received as a part of URL has precedence
        logDebug(`doLogin(): token from params stored to sessionStorage, now removing the token hash from the url`);
        storeSsoUri(location);

        token = location.hash.substr(tokenStart + 'token='.length);
        window.sessionStorage.setItem('OVIRT_PROVIDER_TOKEN', token);
        logDebug(`doLogin(): token from params stored to sessionStorage, now removing the token hash from the url. `, token);
        window.top.location.hash = '';
        return onLoginSuccessful({ dispatch, token });
    } else if (token) { // found in the sessionStorrage
        logDebug(`doLogin(): token found in sessionStorrage: ${token}`);
        return onLoginSuccessful({ dispatch, token });
    } else {
        redirectToOvirtSSO();
    }
    return false;
}

function onLoginSuccessful ({ dispatch, token }) {
    CONFIG.token = token;

    // Turn-off user notification about progress
    // Provider's reducer subtree must not be initialized at this point
    waitForReducerSubtreeInit(() => dispatch(loginInProgress(false)));

    return checkApiVersion({ dispatch });
}

export function redirectToOvirtSSO () {
    console.info('Redirecting to oVirt SSO');

    // hack to get the dispatch() function without it's extensive passing in the call hierarchy
    store.dispatch(loginInProgress(true)); // for expired token: force user notification to render; connection to oVirt SSO Login page might take a while

    const baseUrl = getOvirtBaseUrl();
    let authorizedRedirect = `${baseUrl}/web-ui/authorizedRedirect.jsp?redirectUrl=`;

    let ssoUri = window.sessionStorage.getItem('OVIRT_PROVIDER_SSO_URI');
    if (ssoUri) {
        // https://[ENGINE_FQDN]:9986/=[OVIRT_HOST_UUID]/machines#access_token=[VALID_OVIRT_ACCESS_TOKEN]
        ssoUri = ssoUri.replace('#', '__hash__');
        authorizedRedirect = authorizedRedirect + `${ssoUri}TOKEN`;
    } else {
        const hostUrl = `https://${window.location.host}`;
        authorizedRedirect = authorizedRedirect + `${hostUrl}/machines/__hash__token=TOKEN`;
    }

    console.info('Redirecting to oVirt SSO: ', authorizedRedirect);
    window.top.location = authorizedRedirect;
}

function checkApiVersion ({ dispatch }) {
    logDebug('checkApiVersion() started');

    const failHandler = (data, ex) => {
        logError('checkApiVersion(): failed to load oVirt API metadata');
        setOvirtApiCheckResult(false);
    };

    return ovirtApiGet(
        ``, // just the /ovirt-engine/api
        {},
        failHandler
    ).then(data => {
        logDebug('checkApiVersion() - API metadata retrieved: ', data);
        const apiMetaData = JSON.parse(data);

        if (!(apiMetaData && apiMetaData['product_info'] && apiMetaData['product_info']['version'] &&
            apiMetaData['product_info']['version']['major'] && apiMetaData['product_info']['version']['minor'])) {
            console.error('Incompatible oVirt API version: ', apiMetaData);

            setOvirtApiCheckResult(false);
            return;
        }

        const actual = apiMetaData['product_info']['version'];
        const passed = compareVersion({ major: parseInt(actual.major, 10), minor: parseInt(actual.minor, 10) }, REQUIRED_OVIRT_API_VERSION);

        logDebug('checkApiVersion(): ', passed);
        setOvirtApiCheckResult(passed);

        if (passed) {
            startOvirtPolling({ dispatch });
        }
    });
}

function compareVersion (actual, required) {
    logDebug(`compareVersion(), actual=${JSON.stringify(actual)}, required=${JSON.stringify(required)}`);

    // assuming backward compatibility of oVirt API
    if (actual.major >= required.major) {
        if (actual.major === required.major) {
            if (actual.minor < required.minor) {
                return false;
            }
        }
        return true;
    }
    return false;
}
