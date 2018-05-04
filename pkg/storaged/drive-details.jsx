/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
import utils from "./utils.js";
import { StdDetailsLayout } from "./details.jsx";
import Content from "./content-views.jsx";

const _ = cockpit.gettext;

export class DriveDetails extends React.Component {
    render() {
        var client = this.props.client;
        var drive = this.props.drive;
        var drive_ata = client.drives_ata[drive.path];
        var drive_block = drive && client.drives_block[drive.path];
        var multipath_blocks = drive && client.drives_multipath_blocks[drive.path];

        function row(title, value) {
            if (value)
                return <tr><td>{title}</td><td>{value}</td></tr>;
            else
                return null;
        }

        var assessment = null;
        if (drive_ata) {
            assessment = (
                <tr>
                    <td>{_("storage", "Assessment")}</td>
                    <td>
                        { drive_ata.SmartFailing
                            ? <span className="cockpit-disk-failing">{_("DISK IS FAILING")}</span>
                            : <span>{_("Disk is OK")}</span>
                        }
                        { drive_ata.SmartTemperature > 0
                            ? <span>({utils.format_temperature(drive_ata.SmartTemperature)})</span>
                            : null
                        }
                    </td>
                </tr>
            );
        }

        var header = (
            <div className="panel panel-default">
                <div className="panel-heading">{_("Drive")}</div>
                <div className="panel-body">
                    <table className="info-table-ct">
                        { row(_("storage", "Model"), drive.Model) }
                        { row(_("storage", "Firmware Version"), drive.Revision) }
                        { row(_("storage", "Serial Number"), drive.Serial) }
                        { row(_("storage", "World Wide Name"), drive.WWN) }
                        { row(_("storage", "Capacity"),
                              drive.Size ? utils.fmt_size_long(drive.Size)
                                  : _("No media inserted")) }
                        { assessment }
                        { row(_("storage", "Device File"), drive_block ? utils.block_name(drive_block) : "-") }
                        { multipath_blocks.length > 0 && row(_("storage", "Multipathed Devices"),
                                                             multipath_blocks.map(utils.block_name).join(" ")) }
                    </table>
                </div>
            </div>
        );

        var content = <Content.Block client={this.props.client} block={drive_block} />;

        return <StdDetailsLayout client={this.props.client} header={header} content={content} />;
    }
}
