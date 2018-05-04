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
import React, { PropTypes } from 'react';
import cockpit from 'cockpit';
import { Listing, ListingRow } from 'cockpit-components-listing.jsx';
import { Info } from './notification/inlineNotification.jsx';
import { convertToUnit, toReadableNumber, units } from "../helpers.es6";

const _ = cockpit.gettext;

const DiskTotal = ({ disks, idPrefix }) => {
    return (
        <span className='machines-disks-total'>
            {_("Count:")}&nbsp;
            <span id={`${idPrefix}-total-value`} className='machines-disks-total-value'>
                {disks.length}
            </span>
        </span>
    );
};

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

const VmDisksTab = ({ idPrefix, disks, renderCapacity, notificationText }) => {
    if (!disks || disks.length === 0) {
        return (<div>{_("No disks defined for this VM")}</div>);
    }

    const renderCapacityUsed = !!disks.find(disk => (!!disk.used));
    const renderReadOnly = !!disks.find(disk => (typeof disk.readonly !== "undefined"));

    const columnTitles = [_("Device"), _("Target")];
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

    let notification = null;
    if (notificationText) {
        notification = (<Info text={notificationText}
                              textId={`${idPrefix}-notification`} />);
    }

    return (
        <div>
            {notification}
            <DiskTotal disks={disks} idPrefix={idPrefix} />
            <Listing columnTitles={columnTitles}>
                {disks.map(disk => {
                    const idPrefixRow = `${idPrefix}-${disk.target || disk.device}`;
                    const columns = [
                        { name: <VmDiskCell value={disk.device} id={`${idPrefixRow}-device`} />, 'header': true },
                        <VmDiskCell value={disk.target} id={`${idPrefixRow}-target`} />
                    ];

                    if (renderCapacity) {
                        if (renderCapacityUsed) {
                            columns.push(<StorageUnit value={disk.used} id={`${idPrefixRow}-used`} />);
                        }
                        columns.push(<StorageUnit value={disk.capacity} id={`${idPrefixRow}-capacity`} />);
                    }

                    columns.push(<VmDiskCell value={disk.bus} id={`${idPrefixRow}-bus`} />);

                    if (renderReadOnly) {
                        columns.push(disk.readonly ? _("yes") : _("no"));
                    }

                    columns.push(disk.diskSourceCell);
                    return (<ListingRow columns={columns} navigateToItem={disk.onNavigate} />);
                })}
            </Listing>
        </div>
    );
};

VmDisksTab.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    disks: PropTypes.array.isRequired,
    renderCapacity: PropTypes.bool,
    notificationText: PropTypes.string,
};

export default VmDisksTab;
