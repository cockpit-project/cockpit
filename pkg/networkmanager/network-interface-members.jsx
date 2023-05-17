/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
import React, { useState, useContext } from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Dropdown, DropdownItem, DropdownToggle } from '@patternfly/react-core/dist/esm/deprecated/components/Dropdown/index.js';
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { MinusIcon } from '@patternfly/react-icons';

import { ListingTable } from "cockpit-components-table.jsx";
import { ModelContext } from './model-context.jsx';
import { useEvent } from "hooks";

import {
    connection_settings,
    device_state_text,
    free_member_connection,
    is_interesting_interface,
    set_member,
    show_unexpected_error,
    syn_click,
    with_checkpoint,
    is_managed,
} from './interfaces.js';
import { fmt_to_fragments } from 'utils.jsx';

const _ = cockpit.gettext;

export const NetworkInterfaceMembers = ({
    members,
    memberIfaces,
    interfaces,
    iface,
    usage_monitor,
    privileged
}) => {
    const model = useContext(ModelContext);
    const [isOpen, setIsOpen] = useState(false);
    useEvent(usage_monitor.grid, "notify");

    function renderMemberRows() {
        const rows = [];

        members.forEach(iface => {
            const member_con = iface.MainConnection;
            const dev = iface.Device;
            const isActive = (dev && dev.State == 100 && dev.Carrier === true);
            const onoff = (
                <Switch
                    aria-label={cockpit.format(_("Switch of $0"), iface.Name)}
                    isDisabled={!privileged}
                    isChecked={!!(dev && dev.ActiveConnection)}
                    onChange={(_event, val) => {
                        if (val) {
                            with_checkpoint(
                                model,
                                function () {
                                    return member_con.activate(dev)
                                            .fail(show_unexpected_error);
                                },
                                {
                                    devices: dev ? [dev] : [],
                                    fail_text: fmt_to_fragments(_("Switching on $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{iface.Name}</b>),
                                    anyway_text: cockpit.format(_("Switch on $0"), iface.Name)
                                });
                        } else if (dev) {
                            with_checkpoint(
                                model,
                                function () {
                                    return dev.disconnect()
                                            .fail(show_unexpected_error);
                                },
                                {
                                    devices: [dev],
                                    fail_text: fmt_to_fragments(_("Switching off $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{iface.Name}</b>),
                                    anyway_text: cockpit.format(_("Switch off $0"), iface.Name)
                                });
                        }
                    } } />
            );

            const row = ({
                columns: [
                    { title: (!dev || is_managed(dev)) ? <Button variant="link" isInline onClick={() => cockpit.location.go([iface.Name])}>{iface.Name}</Button> : iface.Name },
                    // Will add traffic info right after
                    {
                        title: (
                            <div className="btn-group">
                                {onoff}
                                {privileged && <Button variant="secondary"
                                    size="sm"
                                    onClick={syn_click(model, () => {
                                        with_checkpoint(
                                            model,
                                            function () {
                                                return (free_member_connection(member_con)
                                                        .fail(show_unexpected_error));
                                            },
                                            {
                                                devices: dev ? [dev] : [],
                                                fail_text: fmt_to_fragments(_("Removing $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{iface.Name}</b>),
                                                anyway_text: cockpit.format(_("Remove $0"), iface.Name),
                                                hack_does_add_or_remove: true
                                            });
                                        return false;
                                    })}>
                                    <MinusIcon />
                                </Button>}
                            </div>
                        ),
                        props: { className: "pf-v5-c-table__action" }
                    },
                ],
                props: {
                    key: iface.Name,
                    "data-interface": encodeURIComponent(iface.Name),
                    "data-sample-id": isActive ? encodeURIComponent(iface.Name) : null,
                    "data-row-id": iface.Name,
                }
            });

            if (isActive) {
                const samples = usage_monitor.samples[iface.Name];
                row.columns.splice(1, 0, { title: samples ? cockpit.format_bits_per_sec(samples[1][0] * 8) : "" });
                row.columns.splice(2, 0, { title: samples ? cockpit.format_bits_per_sec(samples[0][0] * 8) : "" });
            } else {
                row.columns.splice(1, 0, { title: device_state_text() });
                row.columns.splice(1, 0, { title: "" });
            }

            rows.push(row);
        });
        return rows;
    }

    const main_connection = iface.MainConnection;
    const cs = iface.MainConnection && connection_settings(iface.MainConnection);

    const dropdownItems = (
        interfaces
                .filter(i => {
                    return (is_interesting_interface(i) &&
                        !memberIfaces[i.Name] &&
                        i != iface);
                })
                .map(iface => {
                    const onClick = () => {
                        with_checkpoint(
                            model,
                            () => {
                                return set_member(model, main_connection, main_connection.Settings,
                                                  cs.type, iface.Name, true)
                                        .fail(show_unexpected_error);
                            },
                            {
                                devices: iface.Device ? [iface.Device] : [],
                                fail_text: fmt_to_fragments(_("Adding $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{iface.Name}</b>),
                                anyway_text: cockpit.format(_("Add $0"), iface.Name),
                                hack_does_add_or_remove: true
                            }
                        );
                    };

                    return (
                        <DropdownItem onClick={syn_click(model, onClick)}
                                  key={"add-member-" + iface.Name}
                                  component="button">
                            {iface.Name}
                        </DropdownItem>
                    );
                })
    );

    const add_btn = (
        <Dropdown onSelect={() => setIsOpen(false)}
                  toggle={
                      <DropdownToggle id="add-member" onToggle={(_, isOpen) => setIsOpen(isOpen)}>
                          {_("Add member")}
                      </DropdownToggle>
                  }
                  isOpen={isOpen}
                  position="right"
                  dropdownItems={dropdownItems} />
    );

    return (
        <Card id="network-interface-members" className="network-interface-members">
            <CardHeader actions={{ actions: add_btn }}>
                <CardTitle component="h2">{_("Interface members")}</CardTitle>
            </CardHeader>
            <ListingTable aria-label={_("Interface members")}
                          className="networking-interface-members"
                          variant='compact'
                          columns={[
                              { title: (cs && cs.type == "bond") ? _("Interfaces") : _("Ports"), props: { width: 25 } },
                              { title: _("Sending"), props: { width: 25 } },
                              { title: _("Receiving"), props: { width: 25 } },
                              { title: "" },
                          ]}
                          rows={renderMemberRows()} />
        </Card>
    );
};
