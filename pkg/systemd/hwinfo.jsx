/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
import { Listing, ListingRow } from "cockpit-components-listing.jsx";

import detect from "./hw-detect.es6";

const _ = cockpit.gettext;

const SystemInfo = ({ info }) => (
    <table className="info-table-ct wide-split-table-ct">
        <tbody>
            <tr>
                <th>{ _("Type") }</th>
                <td>{ info.type }</td>
            </tr>
            <tr>
                <th>{ _("Name") }</th>
                <td>{ info.name }</td>
            </tr>
            <tr>
                <th>{ _("Version") }</th>
                <td>{ info.version }</td>
            </tr>
        </tbody>
        <tbody>
            <tr>
                <th>{ _("BIOS") }</th>
                <td>{ info.bios_vendor }</td>
            </tr>
            <tr>
                <th>{ _("BIOS version") }</th>
                <td>{ info.bios_version }</td>
            </tr>
            <tr>
                <th>{ _("BIOS date") }</th>
                <td>{ info.bios_date }</td>
            </tr>
            <tr>
                <th>{ _("CPU") }</th>
                <td>{ (info.nproc > 1) ? `${info.nproc}x ${info.cpu_model}` : info.cpu_model }</td>
            </tr>
        </tbody>
    </table>
);

class HardwareInfo extends React.Component {
    constructor(props) {
        super(props);
        this.sortColumnFields = [ "cls", "model", "vendor", "slot" ];
        this.state = { sortBy: "cls" };
    }

    render() {
        let pci = null;

        if (this.props.info.pci.length > 0) {
            let sortedPci = this.props.info.pci.concat();
            sortedPci.sort((a, b) => a[this.state.sortBy].localeCompare(b[this.state.sortBy]));

            pci = (
                <Listing title={ _("PCI") } columnTitles={ [ _("Class"), _("Model"), _("Vendor"), _("Slot") ] }
                         columnTitleClick={ index => this.setState({ sortBy: this.sortColumnFields[index] }) } >
                    { sortedPci.map(dev => <ListingRow columns={[ dev.cls, dev.model, dev.vendor, dev.slot ]} />) }
                </Listing>
            );
        }

        return (
            <div className="page-ct container-fluid">
                <ol className="breadcrumb">
                    <li><a onClick={ () => cockpit.jump("/system", cockpit.transport.host) }>{ _("System") }</a></li>
                    <li className="active">{ _("Hardware Information") }</li>
                </ol>

                <h2>{ _("System Information") }</h2>
                <SystemInfo info={this.props.info.system}/>

                { pci }
            </div>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);
    detect().then(info => {
        console.debug("hardware info collection data:", JSON.stringify(info));
        React.render(<HardwareInfo info={info} />, document.getElementById("hwinfo"));
    });
});
