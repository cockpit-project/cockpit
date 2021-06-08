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

import { SidePanel, SidePanelRow } from "./side-panel.jsx";
import { fmt_size, drive_name, decode_filename, block_name } from "./utils.js";

const _ = cockpit.gettext;
const C_ = cockpit.gettext;

export class DrivesPanel extends React.Component {
    render() {
        var props = this.props;
        var client = props.client;

        function cmp_drive(path_a, path_b) {
            return client.drives[path_a].SortKey.localeCompare(client.drives[path_b].SortKey);
        }

        function classify_drive(drive) {
            if (drive.MediaRemovable || drive.Media) {
                for (var i = 0; i < drive.MediaCompatibility.length; i++)
                    if (drive.MediaCompatibility[i].indexOf("optical") === 0)
                        return "optical";
                return "removable";
            }

            return (drive.RotationRate === 0) ? "ssd" : "hdd";
        }

        function make_drive(path) {
            var drive = client.drives[path];
            var block = client.drives_block[path];

            if (!block) {
                // A drive without a primary block device might be
                // a unconfigured multipath device.  Try to hobble
                // along here by arbitrarily picking one of the
                // multipath devices.
                block = client.drives_multipath_blocks[path][0];
            }

            if (!block)
                return null;

            var dev = decode_filename(block.Device).replace(/^\/dev\//, "");

            var name = drive_name(drive);
            var classification = classify_drive(drive);
            var size_str = fmt_size(drive.Size);
            var desc;
            if (classification == "removable") {
                if (drive.Size === 0)
                    desc = C_("storage", "Removable drive");
                else
                    desc = size_str + " " + C_("storage", "Removable drive");
            } else if (classification == "optical") {
                desc = C_("storage", "Optical drive");
            } else {
                if (drive.Size === 0)
                    desc = C_("Drive");
                else
                    desc = size_str;
            }

            return (
                <SidePanelRow client={client}
                              name={name}
                              devname={block_name(block)}
                              detail={desc}
                              location={"#/" + dev}
                              job_path={path}
                              key={path} />
            );
        }

        var drives = Object.keys(client.drives).sort(cmp_drive)
                .map(make_drive);

        return (
            <SidePanel id="drives"
                       className="storage-drives-list"
                       title={_("Drives")}
                       empty_text={_("No drives attached")}
                       show_all_text={cockpit.format(cockpit.ngettext("Show $0 drive", "Show all $0 drives", drives.length), drives.length)}>
                { drives }
            </SidePanel>
        );
    }
}
