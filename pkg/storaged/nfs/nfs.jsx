/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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
import React from "react";
import client from "../client";

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { NetworkIcon } from "../icons/gnome-icons.jsx";
import {
    dialog_open, TextInput, ComboBox, CheckBoxes,
    StopProcessesMessage, stop_processes_danger_message
} from "../dialog.jsx";

import { StorageUsageBar } from "../storage-controls.jsx";
import {
    StorageCard, StorageDescription,
    new_page, new_card, PAGE_CATEGORY_NETWORK,
    navigate_to_new_card_location, navigate_away_from_card
} from "../pages.jsx";
import { parse_options, unparse_options, extract_option } from "../utils.js";

const _ = cockpit.gettext;

function nfs_busy_dialog(dialog_title, entry, error, action_title, action) {
    function show(users) {
        if (users.length === 0) {
            dialog_open({
                Title: dialog_title,
                Body: error.toString()
            });
        } else {
            dialog_open({
                Title: dialog_title,
                Teardown: <StopProcessesMessage users={users} />,
                Action: {
                    DangerButton: true,
                    Danger: stop_processes_danger_message(users),
                    Title: action_title,
                    action: function () {
                        return action(users);
                    }
                }
            });
        }
    }

    client.nfs.entry_users(entry)
            .then(function (users) {
                show(users);
            })
            .catch(function () {
                show([]);
            });
}

function get_exported_directories(server) {
    return cockpit.spawn(["showmount", "-e", "--no-headers", server], { err: "message" })
            .then(function (output) {
                const dirs = [];
                output.split("\n").forEach(function (line) {
                    const d = line.split(" ")[0];
                    if (d)
                        dirs.push(d);
                });
                return dirs;
            });
}

export function nfs_fstab_dialog(entry, card) {
    const mount_options = entry ? entry.fields[3] : "defaults";
    const split_options = parse_options(mount_options == "defaults" ? "" : mount_options);
    const opt_auto = !extract_option(split_options, "noauto");
    const opt_ro = extract_option(split_options, "ro");
    const extra_options = unparse_options(split_options);

    function mounting_options(vals) {
        let opts = [];
        if (!vals.mount_options.auto)
            opts.push("noauto");
        if (vals.mount_options.ro)
            opts.push("ro");
        if (vals.mount_options.extra !== false)
            opts = opts.concat(parse_options(vals.mount_options.extra));
        return unparse_options(opts);
    }

    function show(busy) {
        let alert = null;
        if (busy)
            alert = <>
                <Alert isInline variant="danger" title={_("This NFS mount is in use and only its options can be changed.")} />
                <br />
            </>;

        let server_to_check = null;
        let server_check_timeout = null;

        function check_server(dlg, server, delay) {
            if (server_check_timeout)
                window.clearTimeout(server_check_timeout);
            server_to_check = server;
            server_check_timeout = window.setTimeout(() => {
                server_check_timeout = null;
                dlg.set_options("remote", { choices: [] });
                get_exported_directories(server).then(choices => {
                    if (server == server_to_check)
                        dlg.set_options("remote", { choices });
                });
            }, delay);
        }

        const dlg = dialog_open({
            Title: entry ? _("NFS mount") : _("New NFS mount"),
            Body: alert,
            Fields: [
                TextInput("server", _("Server address"),
                          {
                              value: entry ? entry.fields[0].split(":")[0] : "",
                              validate: function (val) {
                                  if (val === "")
                                      return _("Server cannot be empty.");
                              },
                              disabled: busy
                          }),
                ComboBox("remote", _("Path on server"),
                         {
                             value: entry ? entry.fields[0].split(":")[1] : "",
                             validate: function (val) {
                                 if (val === "")
                                     return _("Path on server cannot be empty.");
                                 if (val[0] !== "/")
                                     return _("Path on server must start with \"/\".");
                             },
                             disabled: busy,
                             choices: [],
                         }),
                TextInput("dir", _("Local mount point"),
                          {
                              value: entry ? entry.fields[1] : "",
                              validate: function (val) {
                                  if (val === "")
                                      return _("Mount point cannot be empty.");
                                  if (val[0] !== "/")
                                      return _("Mount point must start with \"/\".");
                              },
                              disabled: busy
                          }),
                CheckBoxes("mount_options", _("Mount options"),
                           {
                               fields: [
                                   { title: _("Mount at boot"), tag: "auto" },
                                   { title: _("Mount read only"), tag: "ro" },
                                   { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                               ],
                               value: {
                                   auto: opt_auto,
                                   ro: opt_ro,
                                   extra: extra_options === "" ? false : extra_options
                               }
                           },
                ),
            ],
            update: (dlg, vals, trigger) => {
                if (trigger === "server")
                    check_server(dlg, vals.server, 500);
            },
            Action: {
                Title: entry ? _("Save") : _("Add"),
                action: async function (vals) {
                    const fields = [
                        vals.server + ":" + vals.remote,
                        vals.dir,
                        entry ? entry.fields[2] : "nfs",
                        mounting_options(vals) || "defaults"
                    ];
                    if (entry) {
                        await client.nfs.update_entry(entry, fields);
                        if (entry.fields[0] != fields[0] || entry.fields[1] != fields[1])
                            navigate_to_new_card_location(card, ["nfs", fields[0], fields[1]]);
                    } else
                        await client.nfs.add_entry(fields);
                }
            }
        });

        if (entry && !busy)
            check_server(dlg, entry.fields[0].split(":")[0], 0);
    }

    if (entry) {
        client.nfs.entry_users(entry)
                .then(function (users) {
                    show(users.length > 0);
                })
                .catch(function () {
                    show(false);
                });
    } else
        show(false);
}

function checked(error_title, promise) {
    promise.catch(error => {
        dialog_open({
            Title: error_title,
            Body: error.toString()
        });
    });
}

function mount(entry) {
    checked("Could not mount the filesystem",
            client.nfs.mount_entry(entry));
}

function unmount(entry, card) {
    client.nfs.unmount_entry(entry)
            .then(function () {
                if (!entry.fstab)
                    navigate_away_from_card(card);
            })
            .catch(function (error) {
                nfs_busy_dialog(_("Unable to unmount filesystem"),
                                entry, error,
                                _("Stop and unmount"),
                                function (users) {
                                    return client.nfs.stop_and_unmount_entry(users, entry)
                                            .then(function () {
                                                if (!entry.fstab)
                                                    navigate_away_from_card(card);
                                            });
                                });
            });
}

function edit(entry, card) {
    nfs_fstab_dialog(entry, card);
}

function remove(entry, card) {
    client.nfs.remove_entry(entry)
            .then(function () {
                navigate_away_from_card(card);
            })
            .catch(function (error) {
                nfs_busy_dialog(_("Unable to remove mount"),
                                entry, error,
                                _("Stop and remove"),
                                function (users) {
                                    return client.nfs.stop_and_remove_entry(users, entry)
                                            .then(function () {
                                                navigate_away_from_card(card);
                                            });
                                });
            });
}

const NfsEntryUsageBar = ({ entry, not_mounted_text, short }) => {
    if (entry.mounted)
        return <StorageUsageBar stats={client.nfs.get_fsys_size(entry)} critical={0.95} block={entry.fields[1]}
                                short={short} />;
    else
        return not_mounted_text;
};

export function make_nfs_page(parent, entry) {
    const remote = entry.fields[0];
    const local = entry.fields[1];
    let mount_point = local;
    if (!entry.mounted)
        mount_point += " " + _("(not mounted)");

    const nfs_card = new_card({
        title: _("NFS mount"),
        location: mount_point,
        next: null,
        page_location: ["nfs", remote, local],
        page_name: remote,
        page_icon: NetworkIcon,
        page_category: PAGE_CATEGORY_NETWORK,
        page_size: <NfsEntryUsageBar key="size" entry={entry} not_mounted_text={null} short />,
        component: NfsCard,
        props: { entry },
        actions: [
            (entry.mounted
                ? { title: _("Unmount"), action: () => unmount(entry, nfs_card) }
                : { title: _("Mount"), action: () => mount(entry) }),
            (entry.fstab
                ? { title: _("Edit"), action: () => edit(entry, nfs_card) }
                : null),
            (entry.fstab
                ? { title: _("Remove"), action: () => remove(entry, nfs_card), danger: true }
                : null),
        ]
    });

    new_page(parent, nfs_card);
}

const NfsCard = ({ card, entry }) => {
    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Server")} value={entry.fields[0]} />
                    <StorageDescription title={_("Mount point")} value={entry.fields[1]} />
                    <StorageDescription title={_("Size")}>
                        <NfsEntryUsageBar entry={entry} not_mounted_text="--" />
                    </StorageDescription>
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
