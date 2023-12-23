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
import { superuser } from 'superuser';

const _ = cockpit.gettext;

// see https://github.com/PackageKit/PackageKit/blob/main/lib/packagekit-glib2/pk-enum.h
export const Enum = {
    EXIT_SUCCESS: 1,
    EXIT_FAILED: 2,
    EXIT_CANCELLED: 3,
    ROLE_REFRESH_CACHE: 13,
    ROLE_UPDATE_PACKAGES: 22,
    INFO_UNKNOWN: -1,
    INFO_LOW: 3,
    INFO_ENHANCEMENT: 4,
    INFO_NORMAL: 5,
    INFO_BUGFIX: 6,
    INFO_IMPORTANT: 7,
    INFO_SECURITY: 8,
    INFO_DOWNLOADING: 10,
    INFO_UPDATING: 11,
    INFO_INSTALLING: 12,
    INFO_REMOVING: 13,
    INFO_REINSTALLING: 19,
    INFO_DOWNGRADING: 20,
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
    TRANSACTION_FLAG_SIMULATE: (1 << 2),
};

export const transactionInterface = "org.freedesktop.PackageKit.Transaction";

let _dbus_client = null;

/**
 * Get PackageKit D-Bus client
 *
 * This will get lazily initialized and re-initialized after PackageKit
 * disconnects (due to a crash or idle timeout).
 */
function dbus_client() {
    if (_dbus_client === null) {
        _dbus_client = cockpit.dbus("org.freedesktop.PackageKit", { superuser: "try", track: true });
        _dbus_client.addEventListener("close", () => {
            console.log("PackageKit went away from D-Bus");
            _dbus_client = null;
        });
    }

    return _dbus_client;
}

// Reconnect when privileges change
superuser.addEventListener("changed", () => { _dbus_client = null });

/**
 * Call a PackageKit method
 */
export function call(objectPath, iface, method, args, opts) {
    return dbus_client().call(objectPath, iface, method, args, opts);
}

/**
 * Figure out whether PackageKit is available and usable
 */
export function detect() {
    function dbus_detect() {
        return call("/org/freedesktop/PackageKit", "org.freedesktop.DBus.Properties",
                    "Get", ["org.freedesktop.PackageKit", "VersionMajor"])
                .then(() => true,
                      () => false);
    }

    return cockpit.spawn(["findmnt", "-T", "/usr", "-n", "-o", "VFS-OPTIONS"])
            .then(options => {
                if (options.split(",").indexOf("ro") >= 0)
                    return false;
                else
                    return dbus_detect();
            })
            .catch(dbus_detect);
}

/**
 * Watch a running PackageKit transaction
 *
 * transactionPath (string): D-Bus object path of the PackageKit transaction
 * signalHandlers, notifyHandler: As in method #transaction
 * Returns: If notifyHandler is set, Cockpit promise that resolves when the watch got set up
 */
export function watchTransaction(transactionPath, signalHandlers, notifyHandler) {
    const subscriptions = [];
    let notifyReturn;
    const client = dbus_client();

    // Listen for PackageKit crashes while the transaction runs
    function onClose(event, ex) {
        console.warn("PackageKit went away during transaction", transactionPath, ":", JSON.stringify(ex));
        if (signalHandlers.ErrorCode)
            signalHandlers.ErrorCode("close", _("PackageKit crashed"));
        if (signalHandlers.Finished)
            signalHandlers.Finished(Enum.EXIT_FAILED);
    }
    client.addEventListener("close", onClose);

    if (signalHandlers) {
        Object.keys(signalHandlers).forEach(handler => subscriptions.push(
            client.subscribe({ interface: transactionInterface, path: transactionPath, member: handler },
                             (path, iface, signal, args) => signalHandlers[handler](...args)))
        );
    }

    if (notifyHandler) {
        notifyReturn = client.watch(transactionPath);
        subscriptions.push(notifyReturn);
        client.addEventListener("notify", reply => {
            const iface = reply?.detail?.[transactionPath]?.[transactionInterface];
            if (iface)
                notifyHandler(iface, transactionPath);
        });
    }

    // unsubscribe when transaction finished
    subscriptions.push(client.subscribe(
        { interface: transactionInterface, path: transactionPath, member: "Finished" },
        () => {
            subscriptions.map(s => s.remove());
            client.removeEventListener("close", onClose);
        })
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
 * notifyHandler (function): handler for https://cockpit-project.org/guide/latest/cockpit-dbus.html#cockpit-dbus-onnotify
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
    return call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "CreateTransaction", [])
            .then(([transactionPath]) => {
                if (!signalHandlers && !notifyHandler)
                    return transactionPath;

                const watchPromise = watchTransaction(transactionPath, signalHandlers, notifyHandler) || Promise.resolve();
                return watchPromise.then(() => {
                    if (method) {
                        return call(transactionPath, transactionInterface, method, arglist)
                                .then(() => transactionPath);
                    } else {
                        return transactionPath;
                    }
                });
            });
}

export class TransactionError extends Error {
    constructor(code, detail) {
        super(detail);
        this.detail = detail;
        this.code = code;
    }
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
 * Returns: Promise that resolves when the transaction finished successfully, or rejects with TransactionError
 *          on failure.
 */
export function cancellableTransaction(method, arglist, progress_cb, signalHandlers) {
    if (signalHandlers?.ErrorCode || signalHandlers?.Finished)
        throw Error("cancellableTransaction handles ErrorCode and Finished signals internally");

    return new Promise((resolve, reject) => {
        let cancelled = false;
        let status;
        let allow_wait_status = false;
        const progress_data = {
            waiting: false,
            absolute_percentage: 0,
            cancel: null
        };

        function changed(props, transaction_path) {
            function cancel() {
                call(transaction_path, transactionInterface, "Cancel", []);
                cancelled = true;
            }

            if (progress_cb) {
                if ("Status" in props)
                    status = props.Status;
                progress_data.waiting = allow_wait_status && (status === Enum.STATUS_WAIT || status === Enum.STATUS_WAITING_FOR_LOCK);
                if ("AllowCancel" in props)
                    progress_data.cancel = props.AllowCancel ? cancel : null;
                if ("Percentage" in props && props.Percentage <= 100)
                    progress_data.absolute_percentage = props.Percentage;

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
                            reject(new TransactionError(cancelled ? "cancelled" : code, detail));
                        },
                        Finished: exit => {
                            progress_cb = null;
                            resolve(exit);
                        },
                    }, signalHandlers || {}),
                    changed)
                .catch(ex => {
                    progress_cb = null;
                    reject(ex);
                });
    });
}

/**
 * Check Red Hat subscription-manager if if this is an unregistered RHEL
 * system. If subscription-manager is not installed or required (not a
 * Red Hat product), nothing happens.
 *
 * callback: Called with a boolean (true: registered, false: not registered)
 *           after querying subscription-manager once, and whenever the value
 *           changes.
 */
export function watchRedHatSubscription(callback) {
    const sm = cockpit.dbus("com.redhat.RHSM1");

    function check() {
        sm.call(
            "/com/redhat/RHSM1/Entitlement", "com.redhat.RHSM1.Entitlement", "GetStatus", ["", ""])
                .then(result => {
                    const status = JSON.parse(result[0]);
                    callback(status.valid);
                })
                .catch(ex => console.warn("Failed to query RHEL subscription status:", JSON.stringify(ex)));
    }

    // check if subscription is required on this system, i.e. whether there are any installed products
    sm.call("/com/redhat/RHSM1/Products", "com.redhat.RHSM1.Products", "ListInstalledProducts", ["", {}, ""])
            .then(result => {
                const products = JSON.parse(result[0]);
                if (products.length === 0)
                    return;

                // check if this is an unregistered RHEL system
                sm.subscribe(
                    {
                        path: "/com/redhat/RHSM1/Entitlement",
                        interface: "com.redhat.RHSM1.Entitlement",
                        member: "EntitlementChanged"
                    },
                    () => check()
                );

                check();
            })
            .catch(ex => {
                if (ex.problem != "not-found")
                    console.warn("Failed to query RHSM products:", JSON.stringify(ex));
            });
}

/* Support for installing missing packages.
 *
 * First call check_missing_packages to determine whether something
 * needs to be installed, then call install_missing_packages to
 * actually install them.
 *
 * check_missing_packages resolves to an object that can be passed to
 * install_missing_packages.  It contains these fields:
 *
 * - missing_names:     Packages that were requested, are currently not installed,
 *                      and can be installed.
 *
 * - missing_ids:       The full PackageKit IDs corresponding to missing_names
 *
 * - unavailable_names: Packages that were requested, are currently not installed,
 *                      but can't be found in any repository.
 *
 * If unavailable_names is empty, a simulated installation of the missing packages
 * is done and the result also contains these fields:
 *
 * - extra_names:       Packages that need to be installed as dependencies of
 *                      missing_names.
 *
 * - remove_names:      Packages that need to be removed.
 *
 * - download_size:     Bytes that need to be downloaded.
 */

export function check_missing_packages(names, progress_cb) {
    const data = {
        missing_ids: [],
        missing_names: [],
        unavailable_names: [],
    };

    if (names.length === 0)
        return Promise.resolve(data);

    function refresh() {
        return cancellableTransaction("RefreshCache", [false], progress_cb);
    }

    function resolve() {
        const installed_names = { };

        return cancellableTransaction("Resolve",
                                      [Enum.FILTER_ARCH | Enum.FILTER_NOT_SOURCE | Enum.FILTER_NEWEST, names],
                                      progress_cb,
                                      {
                                          Package: (info, package_id) => {
                                              const parts = package_id.split(";");
                                              const repos = parts[3].split(":");
                                              if (repos.indexOf("installed") >= 0) {
                                                  installed_names[parts[0]] = true;
                                              } else {
                                                  data.missing_ids.push(package_id);
                                                  data.missing_names.push(parts[0]);
                                              }
                                          },
                                      })
                .then(() => {
                    names.forEach(name => {
                        if (!installed_names[name] && data.missing_names.indexOf(name) == -1)
                            data.unavailable_names.push(name);
                    });
                    return data;
                });
    }

    function simulate(data) {
        data.install_ids = [];
        data.remove_ids = [];
        data.extra_names = [];
        data.remove_names = [];

        if (data.missing_ids.length > 0 && data.unavailable_names.length === 0) {
            return cancellableTransaction("InstallPackages",
                                          [Enum.TRANSACTION_FLAG_SIMULATE, data.missing_ids],
                                          progress_cb,
                                          {
                                              Package: (info, package_id) => {
                                                  const name = package_id.split(";")[0];
                                                  if (info == Enum.INFO_REMOVING) {
                                                      data.remove_ids.push(package_id);
                                                      data.remove_names.push(name);
                                                  } else if (info == Enum.INFO_INSTALLING ||
                                                             info == Enum.INFO_UPDATING) {
                                                      data.install_ids.push(package_id);
                                                      if (data.missing_names.indexOf(name) == -1)
                                                          data.extra_names.push(name);
                                                  }
                                              }
                                          })
                    .then(() => {
                        data.missing_names.sort();
                        data.extra_names.sort();
                        data.remove_names.sort();
                        return data;
                    });
        } else {
            return data;
        }
    }

    function get_details(data) {
        data.download_size = 0;
        if (data.install_ids.length > 0) {
            return cancellableTransaction("GetDetails",
                                          [data.install_ids],
                                          progress_cb,
                                          {
                                              Details: details => {
                                                  if (details.size)
                                                      data.download_size += details.size.v;
                                              }
                                          })
                    .then(() => data);
        } else {
            return data;
        }
    }

    return refresh().then(resolve)
            .then(simulate)
            .then(get_details);
}

/* Check a list of packages whether they are installed.
 *
 * This is a lightweight version of check_missing_packages() which does not
 * refresh, simulates, or retrieves details. It just checks which of the given package
 * names are already installed, and returns a Set of the missing ones.
 */
export function check_uninstalled_packages(names) {
    const uninstalled = new Set(names);

    if (names.length === 0)
        return Promise.resolve(uninstalled);

    return cancellableTransaction("Resolve",
                                  [Enum.FILTER_ARCH | Enum.FILTER_NOT_SOURCE | Enum.FILTER_INSTALLED, names],
                                  null, // don't need progress, this is fast
                                  {
                                      Package: (info, package_id) => {
                                          const parts = package_id.split(";");
                                          uninstalled.delete(parts[0]);
                                      },
                                  })
            .then(() => uninstalled);
}

/* Carry out what check_missing_packages has planned.
 *
 * In addition to the usual "waiting", "percentage", and "cancel"
 * fields, the object reported by progress_cb also includes "info" and
 * "package" from the "Package" signal.
 */

export function install_missing_packages(data, progress_cb) {
    if (!data || data.missing_ids.length === 0)
        return Promise.resolve();

    let last_progress, last_info, last_name;

    function report_progess() {
        progress_cb({
            waiting: last_progress.waiting,
            percentage: last_progress.percentage,
            cancel: last_progress.cancel,
            info: last_info,
            package: last_name
        });
    }

    return cancellableTransaction("InstallPackages", [0, data.missing_ids],
                                  p => {
                                      last_progress = p;
                                      report_progess();
                                  },
                                  {
                                      Package: (info, id) => {
                                          last_info = info;
                                          last_name = id.split(";")[0];
                                          report_progess();
                                      }
                                  });
}

/**
 * Get the used backendName in PackageKit.
 */
export function getBackendName() {
    return call("/org/freedesktop/PackageKit", "org.freedesktop.DBus.Properties",
                "Get", ["org.freedesktop.PackageKit", "BackendName"]);
}
