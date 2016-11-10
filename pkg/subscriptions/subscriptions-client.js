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

var cockpit = require("cockpit");
var _ = cockpit.gettext;

var client = { };

cockpit.event_target(client);

client.subscriptionStatus = {
    serviceStatus: undefined,
    status: undefined,
    products: [],
    error: undefined,
};

// we trigger an event called "dataChanged" when the data has changed

// DBUS service
var service;

function needRender() {
    var ev = document.createEvent("Event");
    ev.initEvent("dataChanged", false, false);
    client.dispatchEvent(ev);
}

/* we trigger status update via dbus
 * if we don't get a timely reply, consider subscription-manager failure
 */
var updateTimeout;

/*
 * Parses lines like:
 *
 * id:  text
 */
function parseSingleSubscription(text) {
    var ret = { };
    text.split('\n').forEach(function(line, i) {
        var pos = line.indexOf(':');
        if (pos !== -1)
            ret[line.substring(0, pos).trim()] = line.substring(pos + 1).trim();
    });
    return ret;
}

function parseMultipleSubscriptions(text) {
    var ret = [ ];
    var segmentInfo, status;
    text.split('\n\n').forEach(function(segment) {
        if (segment.indexOf('Product Name:') === -1)
            return;

        segmentInfo = parseSingleSubscription(segment);

        status = segmentInfo['Status'];

        /* if we have status details, add those to the status */
        if (segmentInfo['Status Details'] !== '')
            status = status + ' (' + segmentInfo['Status Details'] + ')';

        /* convert text output to mustache template variables */
        ret.push({
            'productName': segmentInfo['Product Name'],
            'productId': segmentInfo['Product ID'],
            'version': segmentInfo['Version'],
            'arch': segmentInfo['Arch'],
            'status': status,
            'starts': segmentInfo['Starts'],
            'ends': segmentInfo['Ends'],
        });
    });
    return ret;
}

var gettingDetails = false;
var getDetailsRequested = false;
function getSubscriptionDetails() {
    /* TODO DBus API doesn't deliver what we need, so we call subscription manager
     * without translations and parse the output
     * https://bugzilla.redhat.com/show_bug.cgi?id=1304056
     */
    if (gettingDetails) {
        getDetailsRequested = true;
        return;
    }
    getDetailsRequested = false;
    gettingDetails = true;
    cockpit.spawn(['subscription-manager', 'list'],
                  { directory: '/', superuser: "try", environ: ['LC_ALL=C'] })
        .done(function(output) {
            client.subscriptionStatus.products = parseMultipleSubscriptions(output);
        })
        .fail(function(ex) {
            client.subscriptionStatus.error = ex;
            console.warn("Subscriptions [getSubscriptionDetails]: couldn't get details: " + ex);
        })
        .always(function(output) {
            gettingDetails = false;
            if (getDetailsRequested)
                getSubscriptionDetails();
            needRender();
        });
}

client.registerSystem = function(subscriptionDetails) {
    var dfd = cockpit.defer();

    var args = ['subscription-manager', 'register'];
    if (subscriptionDetails.url != 'default')
        args.push('--serverurl', subscriptionDetails.serverUrl);

    // activation keys can't be used with auto-attach
    if (subscriptionDetails.activationKeys)
        args.push('--activationkey', subscriptionDetails.activationKeys);
    else
        args.push('--auto-attach');

    if (subscriptionDetails.user || subscriptionDetails.password) {
        if (!subscriptionDetails.user)
            subscriptionDetails.user = '';
        if (!subscriptionDetails.password)
            subscriptionDetails.password = '';
        args.push('--username', subscriptionDetails.user, '--password', subscriptionDetails.password);
    }

    // proxy is optional
    if (subscriptionDetails.proxy) {
        if (!subscriptionDetails.proxyServer)
            subscriptionDetails.proxyServer = '';
        if (!subscriptionDetails.proxyUser)
            subscriptionDetails.proxyUser = '';
        if (!subscriptionDetails.proxyPass)
            subscriptionDetails.proxyPass = '';
        args.push('--proxy', subscriptionDetails.proxyServer,
                  '--proxyuser', subscriptionDetails.proxyUser,
                  '--proxypass', subscriptionDetails.proxyPass);
    }

    // only pass org info if user provided it
    if (subscriptionDetails.org)
        args.push('--org', subscriptionDetails.org);

    /* TODO DBus API doesn't deliver what we need, so we call subscription manager
     * without translations and parse the output
     * https://bugzilla.redhat.com/show_bug.cgi?id=1304056
     */
    var process = cockpit.spawn(args, {
        directory: '/',
        superuser: "require",
        environ: ['LC_ALL=C'],
        err: "out"
    });

    var promise;
    var buffer = '';
    process
        .input('')
        .stream(function(text) {
            buffer += text;
        })
        .done(function(output) {
            dfd.resolve();
        })
        .fail(function(ex) {
            if (ex.problem === "cancelled") {
                dfd.reject(ex);
                return;
            }

            /* detect error types we recognize, fall back is generic error */
            var invalidUsernameString = 'Invalid username or password.';
            var invalidCredentialsString = 'Invalid Credentials';
            var message = buffer.trim();
            if (message.indexOf(invalidUsernameString) !== -1) {
                message = cockpit.format("$0 ($1)", _("Invalid username or password"), message.substring(invalidUsernameString.length).trim());
            } else if (message.indexOf(invalidCredentialsString) !== -1) {
                message = cockpit.format("$0 ($1)", _("Invalid credentials"), message.substring(invalidCredentialsString.length).trim());
            } else if ((message.indexOf('EOF') === 0) && (message.indexOf('Organization:') !== -1)) {
                message = _("'Organization' required to register.");
            } else if ((message.indexOf('EOF') === 0) && (message.indexOf('Username:') !== -1)) {
                message = _("Login/password or activation key required to register.");
            } else if (message.indexOf('Must provide --org with activation keys') !== -1) {
                message = _("'Organization' required when using activation keys.");
            } else if (message.indexOf('The system has been registered') !== -1) {
                /*
                 * Currently we don't separate registration & subscription.
                 * Our auto-attach may have failed, so close the dialog and
                 * update status.
                 */
                dfd.resolve();
                return;
            } else {
                // unrecognized output
                console.log("unrecognized subscription-manager failure output: ", ex);
            }
            var error = new Error(message);
            dfd.reject(error);
        });

    promise = dfd.promise();
    promise.cancel = function cancel() {
        process.close("cancelled");
        // we have no idea what the current state is
        requestUpdate();
    };

    return promise;
};

client.unregisterSystem = function() {
    var dfd = cockpit.defer();

    var args = ['subscription-manager', 'unregister'];

    /* TODO DBus API doesn't deliver what we need, so we call subscription manager
     * without translations and parse the output
     */
    var process = cockpit.spawn(args, {
        directory: '/',
        superuser: "require",
        environ: ['LC_ALL=C'],
        err: "out"
    });

    client.subscriptionStatus.status = "unregistering";
    needRender();
    var promise;
    var buffer = '';
    process
        .input('')
        .stream(function(text) {
            buffer += text;
        })
        .done(function(output) {
            dfd.resolve();
        })
        .fail(function(ex) {
            if (ex.problem === "cancelled") {
                dfd.reject(ex);
                return;
            }
            var error = new Error(buffer.trim());
            dfd.reject(error);
            requestUpdate();
        });

    promise = dfd.promise();
    promise.cancel = function cancel() {
        process.close("cancelled");
        // we have no idea what the current state is
        requestUpdate();
    };

    return promise;
};

function statusUpdateFailed(reason) {
    console.warn("Subscription status update failed:", reason);
    client.subscriptionStatus.status = "not-found";
    needRender();
}

/* request update via DBus
 * possible status values: https://github.com/candlepin/subscription-manager/blob/30c3b52320c3e73ebd7435b4fc8b0b6319985d19/src/rhsm_icon/rhsm_icon.c#L98
 * [ RHSM_VALID, RHSM_EXPIRED, RHSM_WARNING, RHN_CLASSIC, RHSM_PARTIALLY_VALID, RHSM_REGISTRATION_REQUIRED ]
 */
var subscriptionStatusValues = [
    'RHSM_VALID',
    'RHSM_EXPIRED',
    'RHSM_WARNING',
    'RHN_CLASSIC',
    'RHSM_PARTIALLY_VALID',
    'RHSM_REGISTRATION_REQUIRED'
];
function requestUpdate() {
    service.call(
        '/EntitlementStatus',
        'com.redhat.SubscriptionManager.EntitlementStatus',
        'check_status',
        [])
        .always(function() {
            window.clearTimeout(updateTimeout);
        })
        .done(function(result) {
            client.subscriptionStatus.serviceStatus = subscriptionStatusValues[result[0]];
            client.getSubscriptionStatus();
        })
        .catch(function(ex) {
            statusUpdateFailed("EntitlementStatus.check_status() failed:", ex);
        });

    /* TODO: Don't use a timeout here. Needs better API */
    updateTimeout = window.setTimeout(
        function() {
            statusUpdateFailed("timeout");
        }, 60000);
}

function processStatusOutput(text, exitDetails) {
    if (exitDetails && exitDetails.problem === 'access-denied') {
        client.subscriptionStatus.status = "access-denied";
        needRender();
        return;
    }
    /* if output isn't as expected, maybe not properly installed? */
    if (text.indexOf('Overall Status:') === -1) {
        console.warn(text, exitDetails);
        client.subscriptionStatus.status = "not-found";
        return;
    }

    /* clear old subscription details */
    client.subscriptionStatus.products = [];

    var status = parseSingleSubscription(text);
    client.subscriptionStatus.status = status['Overall Status'];

    /* if refresh was requested, try again - otherwise get details */
    if (client.subscriptionStatus !== 'Unknown')
        getSubscriptionDetails();
    else
        needRender();
}

var gettingStatus = false;
var getStatusRequested = false;
/* get subscription summary using 'subscription-manager status'*/
client.getSubscriptionStatus = function() {
    if (gettingStatus) {
        getStatusRequested = true;
        return;
    }
    getStatusRequested = false;
    gettingStatus = true;
    /* we need a buffer for 'subscription-manager status' output, since that can fail with a return code != 0
     * even if we need its output (no valid subscription)
     */
    var status_buffer = '';
    /* TODO DBus API doesn't deliver what we need, so we call subscription manager
     * without translations and parse the output
     *
     * 'subscription-manager status' will only return with exit code 0 if all is well (and subscriptions current)
     */
    cockpit.spawn(['subscription-manager', 'status'],
                  { directory: '/', superuser: "try", environ: ['LC_ALL=C'], err: "out" })
        .stream(function(text) {
            status_buffer += text;
        }).done(function(text) {
            processStatusOutput(status_buffer + text, undefined);
        }).fail(function(ex) {
            processStatusOutput(status_buffer, ex);
        }).always(function() {
            gettingStatus = false;
            if (getStatusRequested)
                client.getSubscriptionStatus();
        });
};

client.init = function() {
    service = cockpit.dbus('com.redhat.SubscriptionManager');

    /* we want to get notified if subscription status of the system changes */
    service.subscribe(
        { path: '/EntitlementStatus',
          interface: 'com.redhat.SubscriptionManager.EntitlementStatus',
          member: 'entitlement_status_changed'
        },
        function(path, dbus_interface, signal, args) {
            window.clearTimeout(updateTimeout);
            /*
             * status has changed, now get actual status via command line
             * since older versions of subscription-manager don't deliver this via DBus
             * note: subscription-manager needs superuser privileges
             */

            client.getSubscriptionStatus();
        }
    );

    /* ideally we could get detailed subscription info via DBus, but we
     * can't rely on this being present on all systems we work on
     */
    service.subscribe(
        { path: "/EntitlementStatus",
          interface: "org.freedesktop.DBUS.Properties",
          member: "PropertiesChanged"
        },
        function(path, iface, signal, args) {
            client.getSubscriptionStatus();
        }
    );

    // get initial status
    requestUpdate();
};

module.exports = client;
