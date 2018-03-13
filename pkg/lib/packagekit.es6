/*jshint esversion: 6 */

/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017, 2018 Red Hat, Inc.
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

import cockpit from "cockpit";

// see https://github.com/hughsie/PackageKit/blob/master/lib/packagekit-glib2/pk-enum.h
export const Enum = {
    EXIT_SUCCESS: 1,
    EXIT_FAILED: 2,
    EXIT_CANCELLED: 3,
    ROLE_REFRESH_CACHE: 13,
    ROLE_UPDATE_PACKAGES: 22,
    INFO_LOW: 3,
    INFO_ENHANCEMENT: 4,
    INFO_NORMAL: 5,
    INFO_BUGFIX: 6,
    INFO_IMPORTANT: 7,
    INFO_SECURITY: 8,
    STATUS_WAIT: 1,
    STATUS_DOWNLOAD: 8,
    STATUS_INSTALL: 9,
    STATUS_UPDATE: 10,
    STATUS_CLEANUP: 11,
    STATUS_SIGCHECK: 14,
    STATUS_WAITING_FOR_LOCK: 30,
    FILTER_INSTALLED: (1 << 2),
    FILTER_NOT_INSTALLED: (1 << 3),
    FILTER_NEWEST: (1 << 16),
    FILTER_ARCH: (1 << 18),
    FILTER_NOT_SOURCE: (1 << 21),
    ERROR_ALREADY_INSTALLED: 9,
};

export const transactionInterface = "org.freedesktop.PackageKit.Transaction";

export const dbus_client = cockpit.dbus("org.freedesktop.PackageKit", { superuser: "try", "track": true });

/**
 * Watch a running PackageKit transaction
 *
 * transactionPath (string): D-Bus object path of the PackageKit transaction
 * signalHandlers, notifyHandler: As in method #transaction
 * Returns: If notifyHandler is set, Cockpit promise that resolves when the watch got set up
 */
export function watchTransaction(transactionPath, signalHandlers, notifyHandler) {
    var subscriptions = [];
    var notifyReturn;

    if (signalHandlers) {
        Object.keys(signalHandlers).forEach(handler => subscriptions.push(
            dbus_client.subscribe({ interface: transactionInterface, path: transactionPath, member: handler },
                                  (path, iface, signal, args) => signalHandlers[handler](...args)))
        );
    }

    if (notifyHandler) {
        notifyReturn = dbus_client.watch(transactionPath);
        subscriptions.push(notifyReturn);
        dbus_client.addEventListener("notify", reply => {
            if (transactionPath in reply.detail && transactionInterface in reply.detail[transactionPath])
                notifyHandler(reply.detail[transactionPath][transactionInterface], transactionPath);
        });
    }

    // unsubscribe when transaction finished
    subscriptions.push(dbus_client.subscribe(
        { interface: transactionInterface, path: transactionPath, member: "Finished" },
        () => subscriptions.map(s => s.remove()))
    );

    return notifyReturn;
}

/**
 * Run a PackageKit transaction
 *
 * method (string): D-Bus method name on the https://www.freedesktop.org/software/PackageKit/gtk-doc/Transaction.html interface
 *                  If undefined, only a transaction will be created without calling a method on it
 * arglist (array): "in" arguments of @method
 * signalHandlers (object): maps PackageKit.Transaction signal names to handlers
 * notifyHandler (function): handler for http://cockpit-project.org/guide/latest/cockpit-dbus.html#cockpit-dbus-onnotify
 *                           signals, called on property changes with (changed_properties, transaction_path)
 * Returns: Promise that resolves with transaction path on success, or rejects on an error
 *
 * Note that most often you don't really need the transaction path, but want to
 * listen to the "Finished" signal.
 *
 * Example:
 *     transaction("GetUpdates", [0], {
 *             Package: (info, packageId, _summary) => { ... },
 *             ErrorCode: (code, details) => { ... },
 *         },
 *         changedProps => { ... }  // notify handler
 *     )
 *        .then(transactionPath => { ... })
 *        .catch(ex => { handle exception });
 */
export function transaction(method, arglist, signalHandlers, notifyHandler) {
    return new Promise((resolve, reject) => {
        dbus_client.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "CreateTransaction", [], {timeout: 5000})
            .done(result => {
                let transactionPath = result[0];
                let watchPromise;
                if (signalHandlers || notifyHandler)
                    watchPromise = watchTransaction(transactionPath, signalHandlers, notifyHandler);
                if (!watchPromise)
                    watchPromise = cockpit.resolve();

                watchPromise
                .done(() => {
                    if (method) {
                        dbus_client.call(transactionPath, transactionInterface, method, arglist)
                            .done(() => resolve(transactionPath))
                            .fail(reject);
                    } else {
                        resolve(transactionPath);
                    }
                })
                .fail(reject);
            })
            .fail(reject);
    });
}

/**
 * Run a long cancellable PackageKit transaction
 *
 * method (string): D-Bus method name on the https://www.freedesktop.org/software/PackageKit/gtk-doc/Transaction.html interface
 * arglist (array): "in" arguments of @method
 * progress_cb: Callback that receives a {waiting, percentage, cancel} object regularly; if cancel is not null, it can
 *              be called to cancel the current transaction. if wait is true, PackageKit is waiting for its lock (i. e.
 *              on another package operation)
 * signalHandlers, notifyHandler: As in method #transaction, but ErrorCode and Finished are handled internally
 * Returns: Promise that resolves when the transaction finished successfully, or rejects with {detail, code}
 *          on failure.
 */
export function cancellableTransaction(method, arglist, progress_cb, signalHandlers) {
    if (signalHandlers && (signalHandlers.ErrorCode || signalHandlers.Finished))
        throw "cancellableTransaction handles ErrorCode and Finished signals internally";

    return new Promise((resolve, reject) => {
        let cancelled = false;
        let status;
        let allow_wait_status = false;
        let progress_data = {
            waiting: false,
            percentage: 0,
            cancel: null
        };

        function changed(props, transaction_path) {
            function cancel() {
                dbus_client.call(transaction_path, transactionInterface, "Cancel", []);
                cancelled = true;
            }

            if (progress_cb) {
                if ("Status" in props)
                    status = props.Status;
                progress_data.waiting = allow_wait_status && (status === Enum.STATUS_WAIT || status === Enum.STATUS_WAITING_FOR_LOCK);
                if ("Percentage" in props && props.Percentage <= 100)
                    progress_data.percentage = props.Percentage;
                if ("AllowCancel" in props)
                    progress_data.cancel = props.AllowCancel ? cancel : null;

                progress_cb(progress_data);
            }
        }

        // We ignore STATUS_WAIT and friends during the first second of a transaction.  They
        // are always reported briefly even when a transaction doesn't really need to wait.
        window.setTimeout(() => {
            allow_wait_status = true;
            changed({});
        }, 1000);

        transaction(method, arglist,
            Object.assign({
                // avoid calling progress_cb after ending the transaction, to avoid flickering cancel buttons
                ErrorCode: (code, detail) => {
                    progress_cb = null;
                    reject({ detail, code: cancelled ? "cancelled" : code });
                },
                Finished: (exit, runtime) => {
                    progress_cb = null;
                    resolve(exit);
                },
            }, signalHandlers || {}),
            changed).
            catch(ex => {
                progress_cb = null;
                reject(ex);
            });
    });
}

/**
 * Get appropriate icon classes for an update severity
 *
 * info: An Enum.INFO_* level
 * secSeverity: If given, further classification of the severity of Enum.INFO_SECURITY from the vendor_urls;
 *              e. g. "critical", see https://access.redhat.com/security/updates/classification
 * Returns: Icon classes; put them into <span class="returnvalue">&nbsp;</span>
 *
 */
export function getSeverityIcon(info, secSeverity) {
    if (info == Enum.INFO_SECURITY)
        return "pficon pficon-security" + (secSeverity ? " severity-" + secSeverity : "");
    else if (info >= Enum.INFO_NORMAL)
        return "fa fa-bug";
    else
        return "pficon pficon-enhancement";
}


// possible Red Hat subscription manager status values:
// https://github.com/candlepin/subscription-manager/blob/30c3b52320c3e73ebd7435b4fc8b0b6319985d19/src/rhsm_icon/rhsm_icon.c#L98
// we accept RHSM_VALID(0), RHN_CLASSIC(3), and RHSM_PARTIALLY_VALID(4)
const validSubscriptionStates = [0, 3, 4];

/**
 * Check Red Hat subscription-manager if if this is an unregistered RHEL
 * system. If subscription-manager is not installed, nothing happens.
 *
 * callback: Called with a boolean (true: registered, false: not registered)
 *           after querying subscription-manager once, and whenever the value
 *           changes.
 */
export function watchRedHatSubscription(callback) {
        // check if this is an unregistered RHEL system; if subscription-manager is not installed, ignore
        var sm = cockpit.dbus("com.redhat.SubscriptionManager");
        sm.subscribe(
            { path: "/EntitlementStatus",
              interface: "com.redhat.SubscriptionManager.EntitlementStatus",
              member: "entitlement_status_changed"
            },
            (path, iface, signal, args) => callback(validSubscriptionStates.indexOf(args[0]) >= 0)
        );
        sm.call(
            "/EntitlementStatus", "com.redhat.SubscriptionManager.EntitlementStatus", "check_status")
            .done(result => callback(validSubscriptionStates.indexOf(result[0]) >= 0) )
            .fail(ex => {
                if (ex.problem != "not-found")
                    console.warn("Failed to query RHEL subscription status:", ex);
            }
        );
    }
