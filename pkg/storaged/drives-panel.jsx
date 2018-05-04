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

import { OverviewSidePanel, OverviewSidePanelRow } from "./overview.jsx";
import { fmt_size, drive_name, decode_filename } from "./utils.js";

const _ = cockpit.gettext;
const C_ = cockpit.gettext;

export class DrivesPanel extends React.Component {
    constructor () {
        super();
        this.on_io_samples = () => { this.setState({}); }
    }

    componentDidMount() {
        this.props.client.blockdev_io.addEventListener("changed", this.on_io_samples);
    }

    componentWillUnmount() {
        this.props.client.blockdev_io.removeEventListener("changed", this.on_io_samples);
    }

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
            var io = client.blockdev_io.data[dev];

            var name = drive_name(drive);
            var classification = classify_drive(drive);
            var size_str = fmt_size(drive.Size);
            var desc;
            if (classification == "hdd") {
                desc = size_str + " " + C_("storage", "Hard Disk");
            } else if (classification == "ssd") {
                desc = size_str + " " + C_("storage", "Solid-State Disk");
            } else if (classification == "removable") {
                if (drive.Size === 0)
                    desc = C_("storage", "Removable Drive");
                else
                    desc = size_str + " " + C_("storage", "Removable Drive");
            } else if (classification == "optical") {
                desc = C_("storage", "Optical Drive");
            } else {
                if (drive.Size === 0)
                    desc = C_("storage", "Drive");
                else
                    desc = size_str + " " + C_("storage", "Drive");
            }

            return (
                <OverviewSidePanelRow client={client}
                                      name={name}
                                      detail={desc}
                                      stats={io}
                                      highlight={dev == props.highlight}
                                      go={() => cockpit.location.go([ dev ])}
                                      job_path={path} />
            );
        }

        var drives = Object.keys(client.drives).sort(cmp_drive)
                .map(make_drive);

        return (
            <OverviewSidePanel id="drives"
                               title={_("Drives")}
                               empty_text={_("No drives attached")}>
                { drives }
            </OverviewSidePanel>
        );
    }
}
