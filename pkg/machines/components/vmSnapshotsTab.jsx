/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
import React from 'react';
import moment from "moment";

import cockpit from 'cockpit';
import { vmId } from "../helpers.js";
import { CreateSnapshotModal } from "./vmSnapshotsCreateModal.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { Button, Tooltip } from '@patternfly/react-core';
import { InfoAltIcon } from '@patternfly/react-icons';

import './vmSnapshotsTab.css';

const _ = cockpit.gettext;

function prettyTime(unixTime) {
    const yesterday = _("Yesterday");
    const today = _("Today");
    moment.locale(cockpit.language, {
        calendar : {
            lastDay : `[${yesterday}] LT`,
            sameDay : `[${today}] LT`,
            sameElse : "L LT"
        }
    });

    return moment(Number(unixTime) * 1000).calendar();
}

class VmSnapshotsTab extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            showCreateSnapshotModal: false,
        };

        this.openCreateSnapshot = this.openCreateSnapshot.bind(this);
        this.closeCreateSnapshot = this.closeCreateSnapshot.bind(this);
    }

    openCreateSnapshot() {
        this.setState({ showCreateSnapshotModal: true });
    }

    closeCreateSnapshot() {
        this.setState({ showCreateSnapshotModal: false });
    }

    render() {
        const { vm, dispatch } = this.props;
        const id = vmId(vm.name);

        const emptyCaption = (<div className="no-snapshots">
            <h3>{_("No snapshots")}</h3>
            {_("Previously taken snapshots allow you to revert to an earlier state if something goes wrong")}
        </div>);

        let detailMap = [
            {
                name: _("Creation Time"), value: (snap, snapId) => {
                    const date = prettyTime(snap.creationTime);
                    return (
                        <div id={`${id}-snapshot-${snapId}-date`}>
                            {date}
                        </div>
                    );
                }
            },
            {
                name: _("Name"), value: (snap, snapId) => {
                    return (
                        <div id={`${id}-snapshot-${snapId}-name`}>
                            {snap.name}
                        </div>
                    );
                }
            },
            {
                name: _("Description"), value: (snap, snapId) => {
                    let desc = snap.description;
                    if (!desc)
                        desc = (<span className="snap-greyed-out">{_("No description")}</span>);

                    return (
                        <div id={`${id}-snapshot-${snapId}-description`}>
                            {desc}
                        </div>
                    );
                }
            },
            {
                name: _("VM State"), value: (snap, snapId) => {
                    const statesMap = {
                        shutoff: "shut off",
                        "disk-snapshot": <span className="snap-greyed-out">{_("no state saved")}</span>,
                    };
                    const state = statesMap[snap.state] || snap.state;

                    const infoTips = {
                        shutdown: _("Shutting down"),
                        "disk-snapshot": _("Disk-only snapshot"),
                        blocked: _("Domain is blocked on resource"),
                        crashed: _("Domain has crashed"),
                    };
                    const tooltipMessage = infoTips[snap.state];
                    const tooltip = tooltipMessage
                        ? (<span className="tooltip-circle">
                            <Tooltip entryDelay={0} exitDelay={0} content={tooltipMessage}>
                                <InfoAltIcon />
                            </Tooltip>
                        </span>) : null;

                    return (
                        <div id={`${id}-snapshot-${snapId}-type`}>
                            {state}
                            {tooltip}
                        </div>
                    );
                }
            },
            {
                name: _("Parent Snapshot"), value: (snap, snapId) => {
                    const parentName = snap.parentName || (<span className="snap-greyed-out">{_("No parent")}</span>);

                    return (
                        <div id={`${id}-snapshot-${snapId}-parent`}>
                            {parentName}
                        </div>
                    );
                }
            },
        ];

        detailMap = detailMap.filter(d => !d.hidden);

        const columnTitles = detailMap.map(target => target.name);
        let rows = [];
        if (vm.snapshots) {
            rows = vm.snapshots.sort((a, b) => b.creationTime - a.creationTime).map((target, snapId) => {
                const columns = detailMap.map(d => {
                    let column = null;
                    if (typeof d.value === 'string') {
                        if (target[d.value] !== undefined)
                            column = { title: <div id={`${id}-snapshot-${snapId}-${d.value}`}>{target[d.value]}</div> };
                    }
                    if (typeof d.value === 'function')
                        column = { title: d.value(target, snapId) };

                    return column;
                });
                return { columns };
            });
        }

        return (
            <div className="snapshots-list">
                <Button id={`${id}-add-snapshot-button`} variant="secondary" className="pull-right" onClick={this.openCreateSnapshot}>
                    {_("Create Snapshot")}
                </Button>

                {this.state.showCreateSnapshotModal &&
                    <CreateSnapshotModal dispatch={dispatch}
                        idPrefix={`${id}-create-snapshot`}
                        vm={vm}
                        onClose={this.closeCreateSnapshot} />}

                <div className="ct-table-wrapper">
                    <ListingTable aria-label={`VM ${vm.name} Snapshots Cards`}
                        variant="compact"
                        emptyCaption={emptyCaption}
                        columns={columnTitles}
                        rows={rows} />
                </div>
            </div>
        );
    }
}

export default VmSnapshotsTab;
