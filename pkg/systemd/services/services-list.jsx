/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2010 Red Hat, Inc.
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

import React from "react";

import {
    Button,
    Flex, FlexItem,
    Tooltip, TooltipPosition, Badge,
} from '@patternfly/react-core';
import { ListingTable } from 'cockpit-components-table.jsx';

import cockpit from "cockpit";

const _ = cockpit.gettext;

export const ServicesList = ({ units, isTimer }) => {
    let columns;
    if (!isTimer) {
        columns = [
            { title: _("Unit"), header: true },
            { title: _("State") },
        ];
    } else {
        columns = [
            { title: _("Unit"), header: true },
            { title: _("Trigger"), props: { width: 20 } },
            { title: _("State") },
        ];
    }
    return (
        <ListingTable aria-label={_("Systemd units")}
                      columns={columns}
                      showHeader={false}
                      id="services-list"
                      rows={ units.map(unit => getServicesRow({ key: unit[0], isTimer, shortId: unit[0], ...unit[1] })) }
                      className="services-list" />
    );
};

const getServicesRow = ({ Id, shortId, AutomaticStartup, UnitFileState, LoadState, HasFailed, CombinedState, LastTriggerTime, NextRunTime, Description, isTimer }) => {
    let displayName = shortId;
    // Remove ".service" from services as this is not necessary
    if (shortId.endsWith(".service"))
        displayName = shortId.substring(0, shortId.length - 8);
    const props = { displayName, Description };

    const enabled = UnitFileState && UnitFileState.includes("enabled");
    const disabled = UnitFileState && UnitFileState.includes("disabled");
    const isStatic = UnitFileState && UnitFileState == "static";
    const masked = LoadState && LoadState.includes("masked");
    let unitFileState;
    if (enabled || disabled)
        unitFileState = <Badge className="service-unit-file-state" isRead={!enabled}>{AutomaticStartup}</Badge>;
    else
        unitFileState = <span className="service-unit-file-state service-unit-file-state-non-badge">{AutomaticStartup}</span>;
    let tooltipMessage = "";
    if (enabled)
        tooltipMessage = _("Automatically starts");
    else if (disabled)
        tooltipMessage = _("Does not automatically start");
    else if (masked)
        tooltipMessage = _("Forbidden from running");
    else if (isStatic)
        tooltipMessage = _("Cannot be enabled");

    const columns = [
        {
            title: (
                <div className='service-unit-first-column'>
                    <Button className='service-unit-id'
                            isInline
                            component="a"
                            href={'#/' + shortId}
                            variant='link'>
                        {props.displayName}
                    </Button>
                    {props.Description != shortId && <div className='service-unit-description'>{props.Description}</div>}
                </div>
            )
        },
        {
            title: (
                <Flex id={cockpit.format("$0-service-unit-state", Id)} className='service-unit-status-flex-container'>
                    {CombinedState && <FlexItem flex={{ default: 'flex_2' }} className={"service-unit-status" + (HasFailed ? " service-unit-status-failed" : "")}>
                        {HasFailed && <span className='fa fa-exclamation-circle' />}
                        {CombinedState}
                    </FlexItem>}
                    <FlexItem flex={{ default: 'flex_1' }}>
                        {tooltipMessage ? <Tooltip id="switch-unit-state" content={tooltipMessage} position={TooltipPosition.left}>{unitFileState}</Tooltip> : unitFileState}
                    </FlexItem>
                </Flex>
            ),
            props: {
                className: 'pf-c-table__action service-unit-second-column'
            }
        },
    ];
    if (isTimer) {
        columns.splice(
            1, 0,
            {
                title: (
                    <div className="service-unit-triggers">
                        {NextRunTime && <div className="service-unit-next-trigger">{cockpit.format("Next run: $0", NextRunTime)}</div>}
                        {LastTriggerTime && <div className="service-unit-last-trigger">{cockpit.format("Last trigger: $0", LastTriggerTime)}</div>}
                    </div>
                )
            }
        );
    }

    return {
        props: {
            'data-goto-unit': shortId,
            id: shortId,
            key: shortId,
            className: HasFailed ? "service-unit-failed" : "",
        },
        columns
    };
};
