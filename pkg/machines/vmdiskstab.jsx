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
import React from 'react';
import cockpit from 'cockpit';
// import { Listing, ListingRow } from 'cockpit-components-listing.jsx';

const _ = cockpit.gettext;

const VmDisksTab = ({ vm }) => {
    if (!vm.disks) {
        return (<div>_("No disks defined for this VM")</div>);
    }

    return (
        <div>
            <table className='machines-width-max'>
                <tr className='machines-listing-ct-body-detail'>
                    <td>
                        <table className='form-table-ct'>
                            <tr>
                                <th>{_("Device")}</th>
                                <th>{_("Target")}</th>
                                <th>{_("Bus")}</th>
                                <th>{_("Alias")}</th>
                                <th>{_("Readonly")}</th>
                                <th>{_("Type")}</th>
                                <th>{_("Serial")}</th>
                                <th className=''>{_("Source")}</th>
                            </tr>
                            {Object.getOwnPropertyNames(vm.disks).sort().map(target => {
                                const disk = vm.disks[target];
                                return (
                                    <tr>
                                        <td>{disk.device}</td>
                                        <td>{disk.target}</td>
                                        <td>{disk.bus}</td>
                                        <td>{disk.aliasName}</td>
                                        <td>{disk.readonly ? _("yes") : _("no")}</td>
                                        <td>{disk.type}</td>
                                        <td>{disk.serial}</td>
                                        <td>{disk.sourceFile}</td>
                                    </tr>
                                );
                            })}
                        </table>
                    </td>
                </tr>
            </table>
        </div>);
/*
    <Listing title='blee' columnTitles={[_("Device"), _("Target"), _("Bus"), _("Alias"), _("Readonly"), _("Type"), _("Serial"), _("Source")]}>
        {Object.getOwnPropertyNames(vm.disks).sort().map(target => {
            const disk = vm.disks[target];
            return (
                <ListingRow columns={[
                                        {name: disk.device, 'header': true},
                                        disk.target,
                                        disk.bus,
                                        disk.aliasName,
                                        disk.readonly ? _("yes") : _("no"),
                                        disk.type,
                                        disk.serial,
                                        disk.sourceFile,
                                        ]} />
            );
        })}
    </Listing>
*/
    /*
    return (<div>
        <table className='machines-width-max'>
            <tr className='machines-listing-ct-body-detail'>
                <td>
                    <table className='form-table-ct'>
                        <VmOverviewTabRecord id={`${vmId(vm.name)}-state`} descr={_("State:")} value={vm.state}/>
                        <VmOverviewTabRecord descr={_("Memory:")}
                                             value={cockpit.format_bytes((vm.currentMemory ? vm.currentMemory : 0) * 1024)}/>
                        <VmOverviewTabRecord id={`${vmId(vm.name)}-vcpus`} descr={_("vCPUs:")} value={vm.vcpus}/>
                    </table>
                </td>

                <td>
                    <table className='form-table-ct'>
                        <VmOverviewTabRecord descr={_("ID:")} value={vm.id}/>
                        <VmOverviewTabRecord descr={_("OS Type:")} value={vm.osType}/>
                        <VmOverviewTabRecord descr={_("Autostart:")} value={rephraseUI('autostart', vm.autostart)}/>
                    </table>
                </td>
            </tr>
        </table>
        <VmLastMessage vm={vm} />
    </div>);
    */
};
VmDisksTab.propTypes = {
    vm: React.PropTypes.object.isRequired,
};

export default VmDisksTab;
