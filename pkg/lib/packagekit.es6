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
 */
export function watchTransaction(transactionPath, signalHandlers, notifyHandler) {
    var subscriptions = [];

    if (signalHandlers) {
        Object.keys(signalHandlers).forEach(handler => subscriptions.push(
            dbus_client.subscribe({ interface: transactionInterface, path: transactionPath, member: handler },
                                  (path, iface, signal, args) => signalHandlers[handler](...args)))
        );
    }

    if (notifyHandler) {
        subscriptions.push(dbus_client.watch(transactionPath));
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
}

/**
 * Run a PackageKit transaction
 *
 * method (string): D-Bus method name on the https://www.freedesktop.org/software/PackageKit/gtk-doc/Transaction.html interface
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
                if (signalHandlers || notifyHandler)
                    watchTransaction(transactionPath, signalHandlers, notifyHandler);
                dbus_client.call(transactionPath, transactionInterface, method, arglist)
                    .done(() => resolve(transactionPath))
                    .fail(reject);
            })
            .fail(reject);
    });
}
