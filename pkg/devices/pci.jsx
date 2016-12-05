/*jshint esversion: 6 */
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
import cockpit from 'cockpit';
import React from 'react';

import { Listing, ListingRow } from "cockpit-components-listing.jsx";

import { logDebug, logError, objectValues, stringOrDefault, classNameSorter } from './helpers.es6';
import { rephraseClassName } from './rephrase.es6';
import { selectPciGroupBy, unbindPciDevice, bindPciDevice } from './actions.es6'

const _ = cockpit.gettext;

/**
 * Returns true if the devices uses IOMMU Groups
 */
function isIommuEnabled ({ devices }) {
    const keys = Object.getOwnPropertyNames(devices);
    if (keys.length > 0) {
        const aDevice = devices[keys[0]];
        return aDevice.Iommu !== undefined
    }
    return false;
}

function filterDevices (devices) {
    return devices; // TODO:
}

function sortDevices (devices) {
    return devices; // TODO
}

function groupDevicesBy ({devices, groupBy, defaultGroup = 'default'}) {
    const groups = {};
    Object.getOwnPropertyNames(devices).forEach( slot => {
        const device = devices[slot];
        const groupKey = device[groupBy] === undefined ? defaultGroup : device[groupBy]; // zero is valid
        const group = groups[groupKey] = groups[groupKey] || [];
        group.push(device);
    });

    return groups;
}

const PCIGroupBy = ({ onPciGroupSelected, iommuEnabled, groupBy }) => {
    const forClass = (clz, groupBy) => clz === groupBy ? 'device-groupby-selected' : '';

    return (
        <div className='btn-group pull-right'>
            <button className={`btn btn-link ${forClass('class', groupBy)}`} onclick={() => onPciGroupSelected('class')}>{_('Class')}</button>
            {iommuEnabled ? (<button className={`btn btn-link ${forClass('iommu', groupBy)}`} onclick={() => onPciGroupSelected('iommu')}>{_('IOMMU Group')}</button>) : ''}
            <button className={`btn btn-link ${forClass('list', groupBy)}`} onclick={() => onPciGroupSelected('list')}>{_('List')}</button>
            <button className={`btn btn-link ${forClass('driver', groupBy)}`} onclick={() => onPciGroupSelected('driver')}>{_('Drivers')}</button>
        </div>
    );
};

const PCIDevicePropCode = ({ code }) => {
    if (code) {
        return (
            <span className='device-props-code'>
                (&nbsp;{code}&nbsp;)
            </span>
        );
    }

    return null;
};

const ConfirmButtons = ({ confirmText, dismissText, onYes, onNo }) => {
    return (
        <span>
            <button className='btn btn-danger btn-xs' type='button' onClick={onYes}>{confirmText}</button>
            &nbsp;
            <button className='btn btn-primary btn-xs' type='button' onClick={onNo}>{dismissText}</button>
        </span>
    );
};

class PciDevicePropsDriver extends React.Component {
    constructor (props) {
        super(props)
        this.state = {
            selectedDriver: null,
            confirmUnbind: false
        };
    }

    render () {
        const { device, driverNames, deviceActions } = this.props;

        const onDriverNameChange = e => {
            this.setState({ selectedDriver: e.target.value});
            logDebug(`onDriverNameChange: state: ${JSON.stringify(this.state)}`);
        };

        const onUnbind = () => {
            this.setState({ confirmUnbind: true });
        };

        const onUnBindNo = () => {
            this.setState({ confirmUnbind: false });
        };

        const onUnBindYes = () => {
            this.setState({ confirmUnbind: false });
            deviceActions.onPciDeviceUnbind(device.Slot);
        };

        if (device.Driver) { // Unbind
            return (
                <dd>
                    {this.state.confirmUnbind ?
                        (<ConfirmButtons confirmText={_('Confirm unbind')}
                                         dismissText={_('Cancel')}
                                         onYes={onUnBindYes}
                                         onNo={onUnBindNo}/>)
                        : (<span>
                            <a href='#' onClick={() => deviceActions.onPciDriverSelected(device.Driver)}>{device.Driver}</a>
                            <button className='btn btn-danger btn-xs device-props-driver-button'
                                    type='button' onClick={onUnbind}>
                                {_('Unbind')}
                            </button>
                        </span>)
                    }
                </dd>
            )
        }

        // Bind
        const driverNamesFilterd = driverNames.filter( name => !name.startsWith('(') );
        return (
            <dd>
                <span>
                    <button className='btn btn-primary btn-xs' type='button' disabled={!this.state.selectedDriver}
                            onClick={() => deviceActions.onPciDeviceBind(device.Slot, this.state.selectedDriver)}>
                        Bind To
                    </button>
                    <select className='combobox form-control device-props-driver-combo' onChange={onDriverNameChange}>
                        {!this.state.selectedDriver ? (<option value={this.state.selectedDriver} selected disabled>
                            <i>Choose Driver ...</i>
                        </option>) : ''}
                        {driverNamesFilterd.sort().map(driver => (
                            <option value={driver} selected={driver === this.state.selectedDriver}>{driver}</option>))}
                    </select>
                </span>
            </dd>
        )
    }
};

const PCIDevicePropsMsg = ({ device }) => {
    if (!device.msg) {
        return null;
    }

    return (
        <div>
            <span className='pficon pficon-warning-triangle-o' />
            &nbsp;{device.msg}
        </div>
    )
};

const PCIDeviceProps = ({ device, driverNames, disabledProps, deviceActions }) => {
    const subsystem = device.SDevice ? (
        <dd>
            {device.SDevice}
            <PCIDevicePropCode code={device.SDeviceCode} />
        </dd>
    ) : '';
    const subsystemTitle = subsystem ? (<dt>{_('Subsystem')}</dt>) : '';

    logDebug(`disabledProps: ${JSON.stringify(disabledProps)}`);
    const isIommuEnabled = device.Iommu !== undefined && !(disabledProps && disabledProps.indexOf('Iommu') >= 0);
    const isClassEnabled = !(disabledProps && disabledProps.indexOf('Class') >= 0);

    return (
        <div className='device-props'>
            <div className='container-fluid'>
                <div className='col-sm-4'>
                    <dl>
                        <dt>{_('Vendor')}</dt>
                        <dd>
                            {device.Vendor}
                            <PCIDevicePropCode code={device.VendorCode} />
                        </dd>
                        <dt>{_('Device')}</dt>
                        <dd>
                            {device.Device}
                            <PCIDevicePropCode code={device.DeviceCode} />
                        </dd>
                        {subsystemTitle}
                        {subsystem}
                    </dl>
                </div>
                <div className='col-sm-4'>
                    <dl>
                        <dt>{_('Slot')}</dt>
                        <dd>{device.Slot}</dd>

                        <dt>{_('IOMMU Group')}</dt>
                        <dd>
                            {isIommuEnabled ?
                                (<a href='#' onClick={() => deviceActions.onPciIOMMUGroupSelected(device.Iommu)}>{device.Iommu}</a>)
                                : device.Iommu}
                        </dd>

                        <dt>{_('Class')}</dt>
                        <dd>
                            {isClassEnabled ?
                                (<a href='#' onClick={() => deviceActions.onPciClassSelected(device.Class)}>{device.Class}</a>)
                                : device.Class}
                        </dd>
                    </dl>
                </div>

                <div className='col-sm-4'>
                    <dl>
                        <dt>{_('Module')}</dt>
                        <dd>{device.Module}</dd>

                        <dt>{_('Driver')}</dt>
                        <PciDevicePropsDriver device={device} driverNames={driverNames} deviceActions={deviceActions} />
                    </dl>
                </div>
            </div>

            <PCIDevicePropsMsg device={device} />
        </div>
    );
};

// TODO: Add sorting and filtering
const PCIDevicesGeneral = ({ pciDevices, listingActions }) => {
    const filteredSortered = sortDevices(filterDevices(objectValues(pciDevices)));

    return (
        <div className='container-fluid'>
            <Listing title={_('PCI Devices')} actions={listingActions}
                     columnTitles={[_('Device'), _('Vendor'), _('Class'), _('Driver'), _('IOMMU'), _('Slot')]}>
                {filteredSortered.map(device => (
                    <ListingRow key={device.Slot}
                                columns={[{name: device.Device, header: true}, device.Vendor, device['Class'],
                                    stringOrDefault(device.Driver, ''), stringOrDefault(device.Iommu, ''), device.Slot]}
                    />
                ))}
            </Listing>
        </div>
    );
};

const PCIDevicesOfGroup = ({ devices, driverNames, disabledProps, deviceActions }) => {
    return (
        <div>
            {devices.map(device => (<PCIDeviceProps device={device} key={device.Slot}
                                                    driverNames={driverNames}
                                                    disabledProps={disabledProps}
                                                    deviceActions={deviceActions} />))}
        </div>
    )
};

const PCIDevicesByGroup = ({ groups, groupNameSorterFunc, groupNameRephraseFunc = name => name,
    title, expandedGroup, disabledProps, driverNames, listingActions, deviceActions }) => {
    const sortedGroupNames = (typeof groupNameSorterFunc === 'function') ?
        groupNameSorterFunc(Object.getOwnPropertyNames(groups)) : Object.getOwnPropertyNames(groups);
    return (
        <Listing title={`PCI Devices - by ${title}`} columnTitles={[title, _('Count')]} actions={listingActions}>
            {sortedGroupNames.map(group => (
                <ListingRow key={group} columns={[{name: groupNameRephraseFunc(group), header: true}, `(${groups[group].length})`]}
                            tabRenderers={[ {name: _('Devices'), renderer: PCIDevicesOfGroup,
                                data: {devices: groups[group], driverNames, deviceActions, disabledProps} }]}
                            initiallyExpanded={group == expandedGroup}
                />))}
        </Listing>
    );
};

const Drivers = ({ drivers, expandedGroup, listingActions, deviceActions }) => {
    const disabledProps = ['Driver'];
    const driverNames = Object.getOwnPropertyNames(drivers);

    return (
        <Listing title={_('Drivers')} columnTitles={[_('Driver Name'), _('Attached Devices')]} actions={listingActions}>
            {driverNames.sort().map(driver => {
                return (drivers[driver].length > 0 ? (
                        <ListingRow key={driver}
                                    columns={[{name: driver, header: true}, `(${drivers[driver].length})`]}
                                    tabRenderers={[ {name: _('Attached Devices'), renderer: PCIDevicesOfGroup,
                                        data: {devices: drivers[driver], driverNames, deviceActions, disabledProps} }]}
                                    initiallyExpanded={driver == expandedGroup} />
                    ) : (
                        <ListingRow columns={[{name: driver, header: true}, `(${drivers[driver].length})`]} />
                    )
                );
            })}
        </Listing>
    );
};

// TODO
const PCIDevicesByNumaTopology = () => {
    return (
        <div>
            PCIDevicesByNumaTopology not yet implemented
        </div>
    );
};

const PCIDevices = ({ visibility, pciDevices, pciDrivers, deviceActions }) => {
    const { groupBy, selectedGroup } = visibility;

    const listingActions = (<PCIGroupBy onPciGroupSelected={deviceActions.onPciGroupSelected}
                                        iommuEnabled={isIommuEnabled({devices: pciDevices})}
                                        groupBy={groupBy}/>);

    // const driverNames = Array.from(pciDrivers);

    switch (groupBy) {
        case 'class':
        {
            const byClass = groupDevicesBy({ devices: pciDevices, groupBy: 'Class'});
            return (<PCIDevicesByGroup groups={byClass}
                                       groupNameSorterFunc={classNameSorter}
                                       groupNameRephraseFunc={rephraseClassName}
                                       title={_('Class')}
                                       listingActions={listingActions}
                                       expandedGroup={selectedGroup}
                                       disabledProps={['Class']}
                                       deviceActions={deviceActions}
                                       driverNames={pciDrivers} />);

        }
        case 'iommu':
        {
            const byIommu = groupDevicesBy({ devices: pciDevices, groupBy: 'Iommu'});
            return (<PCIDevicesByGroup groups={byIommu} title={_('IOMMU Group')}
                                       listingActions={listingActions}
                                       expandedGroup={selectedGroup}
                                       disabledProps={['Iommu']}
                                       deviceActions={deviceActions}
                                       driverNames={pciDrivers} />);
        }
        case 'numa': // TODO: recently not used
            return (<PCIDevicesByNumaTopology pciDevices={pciDevices}
                                              listingActions={listingActions} />);
        case 'list':
            return (<PCIDevicesGeneral pciDevices={pciDevices}
                                       listingActions={listingActions} />);
        case 'driver':
        {
            // drivers with references to devices
            const driversWithDevices = groupDevicesBy({ devices: pciDevices, groupBy: 'Driver', defaultGroup: '(unattached devices)'});
            // extend list for unbound drivers too
            pciDrivers.forEach( driverName => {
                driversWithDevices[driverName] = driversWithDevices[driverName] || [];
            });

            return (<Drivers drivers={driversWithDevices}
                             listingActions={listingActions}
                             expandedGroup={visibility.selectedGroup}
                             deviceActions={deviceActions} /> );
        }
        default:
            logError(`PCIDevices component: unknown groupBy='${groupBy}'`);
    }

    return null;
};

export function pciActions (dispatch) {
    return {
        onPciIOMMUGroupSelected: selectedIommuGroup => dispatch(selectPciGroupBy({ groupBy: 'iommu', selectedGroup: selectedIommuGroup})),
        onPciClassSelected: selectedClass => dispatch(selectPciGroupBy({ groupBy: 'class', selectedGroup: selectedClass})),
        onPciDriverSelected: selectedDriver => dispatch(selectPciGroupBy({ groupBy: 'driver', selectedGroup: selectedDriver})),
        onPciGroupSelected: pciGroupBy => dispatch(selectPciGroupBy({ groupBy: pciGroupBy })),

        onPciDeviceBind: (busId, driverName) => dispatch(bindPciDevice({ busId, driverName })),
        onPciDeviceUnbind: busId => dispatch(unbindPciDevice({ busId })),
    };
};

export default PCIDevices;
