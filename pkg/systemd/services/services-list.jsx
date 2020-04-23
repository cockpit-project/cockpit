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
    DataList, DataListItem, DataListCell, DataListItemRow, DataListItemCells, DataListAction,
    Badge,
} from '@patternfly/react-core';
import { OverlayTrigger, Tooltip } from 'patternfly-react';

import cockpit from "cockpit";

const _ = cockpit.gettext;

export const ServicesList = ({ units, isTimer }) => {
    return (
        <DataList aria-label={_("Systemd Units")}
                  id="services-list"
                  onSelectDataListItem={id => cockpit.location.go([id])}
                  className="services-list">
            { units.map(unit => <ServicesRow key={unit.path} isTimer={isTimer} {...unit} />) }
        </DataList>
    );
};

class ServicesRow extends React.PureComponent {
    render() {
        const { Id, shortId, AutomaticStartup, UnitFileState, LoadState, HasFailed, CombinedState, LastTriggerTime, NextRunTime, Description, isTimer } = this.props;
        const props = { shortId, Description };
        const columnsMap = {
            shortId: { value: _("Name"), className: "service-unit-id", width: 2 },
            Description: { value: _("Description"), className: "service-unit-description", width: 4 },
            Triggers: { value: _("Triggers"), timerOnly: true, className: "service-unit-triggers", width: 3 },
        };

        const enabled = UnitFileState === "enabled";
        const disabled = UnitFileState === "disabled";
        const isStatic = !disabled && !enabled;
        const masked = LoadState === "masked";
        let unitFileState;
        if (!isStatic && !masked)
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

        return (
            <DataListItem data-goto-unit={Id} aria-labelledby={Id} id={Id}>
                <DataListItemRow className={HasFailed ? "service-unit-failed" : ""}>
                    <DataListItemCells
                        dataListCells={[Object.keys(columnsMap)
                                .filter(key => isTimer || !columnsMap[key].timerOnly)
                                .map(key => {
                                    return (
                                        <DataListCell width={columnsMap[key].width}
                                                      className={columnsMap[key].className}
                                                      key={cockpit.format("$0-$1", shortId, key)}>
                                            {(columnsMap[key].timerOnly)
                                                ? <>
                                                    {NextRunTime && <div className="service-unit-next-trigger">{cockpit.format("Next Run: $0", NextRunTime)}</div>}
                                                    {LastTriggerTime && <div className="service-unit-last-trigger">{cockpit.format("Last Trigger: $0", LastTriggerTime)}</div>}
                                                </>
                                                : props[key]}
                                        </DataListCell>
                                    );
                                })]} />
                    <DataListAction id={cockpit.format("$0-service-unit-state", Id)}
                                    aria-labelledby={cockpit.format("$0-service-unit-state", Id)}
                                    aria-label={_("State")}>
                        {CombinedState && <span className={"service-unit-status" + (HasFailed ? " service-unit-status-failed" : "")}>
                            {HasFailed && <span className='fa fa-exclamation-circle' />}
                            {CombinedState}
                        </span>}
                        <OverlayTrigger overlay={ <Tooltip id="switch-unit-state">{ tooltipMessage }</Tooltip> } placement='left'>{unitFileState}</OverlayTrigger>
                    </DataListAction>
                </DataListItemRow>
            </DataListItem>
        );
    }
}
