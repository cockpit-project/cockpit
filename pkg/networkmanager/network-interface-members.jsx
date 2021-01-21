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
import { cellWidth } from '@patternfly/react-table';
import {
    Button,
    Card, CardActions, CardTitle, CardHeader,
    Dropdown, DropdownItem, DropdownToggle,
    Switch,
    Text, TextVariants,
} from '@patternfly/react-core';
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

const _ = cockpit.gettext;

export const NetworkInterfaceMembers = ({
    members,
    memberIfaces,
    interfaces,
    iface,
    usage_monitor,
    highlight,
    privileged
}) => {
    const model = useContext(ModelContext);
    const [isOpen, setIsOpen] = useState(false);
    useEvent(usage_monitor.grid, "notify");

    function renderMemberRows() {
        const rows = [];

        members.map(iface => {
            const member_con = iface.MainConnection;
            const dev = iface.Device;
            const isActive = (dev && dev.State == 100 && dev.Carrier === true);
            const onoff = (
                <Switch
                    aria-label={cockpit.format(_("Switch of $0"), iface.Name)}
                    isDisabled={!privileged}
                    isChecked={!!(dev && dev.ActiveConnection)}
                    onChange={val => {
                        if (val) {
                            with_checkpoint(
                                model,
                                function () {
                                    return member_con.activate(dev)
                                            .fail(show_unexpected_error);
                                },
                                {
                                    devices: dev ? [dev] : [],
                                    fail_text: cockpit.format(_("Switching on <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), iface.Name),
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
                                    fail_text: cockpit.format(_("Switching off <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), iface.Name),
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
                            <>
                                {onoff}
                                {privileged && <Button variant="secondary"
                                    isSmall
                                    onClick={syn_click(model, () => {
                                        with_checkpoint(
                                            model,
                                            function () {
                                                return (free_member_connection(member_con)
                                                        .fail(show_unexpected_error));
                                            },
                                            {
                                                devices: dev ? [dev] : [],
                                                fail_text: cockpit.format(_("Removing <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), iface.Name),
                                                anyway_text: cockpit.format(_("Remove $0"), iface.Name),
                                                hack_does_add_or_remove: true
                                            });
                                        return false;
                                    })}>
                                    <MinusIcon />
                                </Button>}
                            </>
                        )
                    }
                ],
                rowId: iface.Name,
                extraClasses: highlight == iface.Name ? ["highlight-ct"] : [],
                props: {
                    key: iface.Name,
                    "data-interface": encodeURIComponent(iface.Name),
                    "data-sample-id": isActive ? encodeURIComponent(iface.Name) : null
                }
            });

            if (isActive) {
                const samples = usage_monitor.samples[iface.Name];
                row.columns.splice(1, 0, { title: samples ? cockpit.format_bits_per_sec(samples[1][0] * 8) : "" });
                row.columns.splice(2, 0, { title: samples ? cockpit.format_bits_per_sec(samples[0][0] * 8) : "" });
            } else {
                row.columns.splice(1, 0, { title: device_state_text(), props: { colSpan: 2 } });
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
                                fail_text: cockpit.format(_("Adding <b>$0</b> will break the connection to the server, and will make the administration UI unavailable."), iface.Name),
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
                      <DropdownToggle id="add-member" onToggle={setIsOpen}>
                          {_("Add member")}
                      </DropdownToggle>
                  }
                  isOpen={isOpen}
                  position="right"
                  dropdownItems={dropdownItems} />
    );

    return (
        <Card id="network-interface-members" className="network-interface-members">
            <CardHeader>
                <CardTitle><Text component={TextVariants.h2}>{_("Interface members")}</Text></CardTitle>
                <CardActions>
                    {add_btn}
                </CardActions>
            </CardHeader>
            <ListingTable aria-label={_("Interface members")}
                          variant='compact'
                          columns={[
                              { title: (cs && cs.type == "bond") ? _("Interfaces") : _("Ports"), transforms: [cellWidth(25)] },
                              { title: _("Sending"), transforms: [cellWidth(25)] },
                              { title: _("Receiving"), transforms: [cellWidth(25)] },
                              { title: "", transforms: [cellWidth(25)] },
                          ]}
                          rows={renderMemberRows()} />
        </Card>
    );
};
