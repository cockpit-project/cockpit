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
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import { Listing, ListingRow } from 'cockpit-components-listing.jsx';
import { Info } from './notification/inlineNotification.jsx';
import { convertToUnit, toReadableNumber, units } from "../helpers.es6";
import RemoveDiskAction from './diskRemove.jsx';

const _ = cockpit.gettext;

const StorageUnit = ({ value, id }) => {
    if (!value) {
        return null;
    }

    if (isNaN(value)) {
        return (
            <div id={id}>
                {value}
            </div>
        );
    }

    return (
        <div id={id}>
            {toReadableNumber(convertToUnit(value, units.B, units.GiB))}&nbsp;{_("GiB")}
        </div>
    );
};

const VmDiskCell = ({ value, id }) => {
    return (
        <div id={id}>
            {value}
        </div>
    );
};

const VmDisksTab = ({ idPrefix, vm, disks, actions, renderCapacity, notificationText, dispatch, provider }) => {
    let notification = null;
    const columnTitles = [_("Device"), _("Target")];
    let renderCapacityUsed, renderReadOnly;

    if (disks && disks.length > 0) {
        renderCapacityUsed = !!disks.find(disk => (!!disk.used));
        renderReadOnly = !!disks.find(disk => (typeof disk.readonly !== "undefined"));

        if (renderCapacity) {
            if (renderCapacityUsed) {
                columnTitles.push(_("Used"));
            }
            columnTitles.push(_("Capacity"));
        }
        columnTitles.push(_("Bus"));
        if (renderReadOnly) {
            columnTitles.push(_("Readonly"));
        }
        columnTitles.push(_("Source"));

        if (notificationText) {
            notification = (<Info text={notificationText}
                                  textId={`${idPrefix}-notification`} />);
        }
    }

    return (
        <div>
            {notification}
            <Listing columnTitles={columnTitles} actions={actions} emptyCaption={_("No disks defined for this VM")}>
                {disks.map(disk => {
                    const idPrefixRow = `${idPrefix}-${disk.target || disk.device}`;
                    const columns = [
                        { name: <VmDiskCell value={disk.device} id={`${idPrefixRow}-device`} key={`${idPrefixRow}-device`} />, 'header': true },
                        <VmDiskCell value={disk.target} id={`${idPrefixRow}-target`} key={`${idPrefixRow}-target`} />
                    ];

                    if (renderCapacity) {
                        if (renderCapacityUsed) {
                            columns.push(<StorageUnit value={disk.used} id={`${idPrefixRow}-used`} key={`${idPrefixRow}-used`} />);
                        }
                        columns.push(<StorageUnit value={disk.capacity} id={`${idPrefixRow}-capacity`} key={`${idPrefixRow}-capacity`} />);
                    }

                    columns.push(<VmDiskCell value={disk.bus} id={`${idPrefixRow}-bus`} key={`${idPrefixRow}-bus`} />);

                    if (renderReadOnly) {
                        columns.push(disk.readonly ? _("yes") : _("no"));
                    }

                    columns.push(disk.diskSourceCell);

                    if (provider === 'LibvirtDBus') {
                        const removeDiskAction = RemoveDiskAction({
                            dispatch,
                            vm,
                            target: disk.target,
                            idPrefixRow,
                        });
                        columns.push(<div>{removeDiskAction}</div>);
                    }

                    return (<ListingRow key={idPrefixRow} columns={columns} navigateToItem={disk.onNavigate} />);
                })}
            </Listing>
        </div>
    );
};

VmDisksTab.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    actions: PropTypes.arrayOf(PropTypes.node),
    disks: PropTypes.array.isRequired,
    renderCapacity: PropTypes.bool,
    notificationText: PropTypes.string,
    provider: PropTypes.string,
};

export default VmDisksTab;
