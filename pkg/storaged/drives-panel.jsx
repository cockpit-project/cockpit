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

import { SidePanel } from "./side-panel.jsx";
import { fmt_size, drive_name, decode_filename, block_name } from "./utils.js";

const _ = cockpit.gettext;
const C_ = cockpit.gettext;

export function drive_rows(client) {
    function cmp_drive(path_a, path_b) {
        return client.drives[path_a].SortKey.localeCompare(client.drives[path_b].SortKey);
    }

    function classify_drive(drive) {
        if (drive.MediaRemovable || drive.Media) {
            for (let i = 0; i < drive.MediaCompatibility.length; i++)
                if (drive.MediaCompatibility[i].indexOf("optical") === 0)
                    return "optical";
            return "removable";
        }

        return (drive.RotationRate === 0) ? "ssd" : "hdd";
    }

    function make_drive(path) {
        const drive = client.drives[path];
        let block = client.drives_block[path];

        if (!block) {
            // A drive without a primary block device might be
            // a unconfigured multipath device.  Try to hobble
            // along here by arbitrarily picking one of the
            // multipath devices.
            block = client.drives_multipath_blocks[path][0];
        }

        if (!block)
            return null;

        const dev = decode_filename(block.Device).replace(/^\/dev\//, "");

        const name = drive_name(drive);
        const classification = classify_drive(drive);
        const size_str = fmt_size(drive.Size);
        let type, desc;
        if (classification == "removable") {
            type = C_("storage", "Removable drive");
            if (drive.Size === 0)
                desc = type;
            else
                desc = size_str + " " + type;
        } else if (classification == "optical") {
            type = C_("storage", "Optical drive");
            desc = type;
        } else {
            type = C_("Drive");
            if (drive.Size === 0)
                desc = type;
            else
                desc = size_str;
        }

        return {
            client,
            name,
            devname: block_name(block),
            size: drive.Size,
            type,
            detail: desc,
            go: () => cockpit.location.go([dev]),
            block: drive && client.drives_block[path],
            job_path: path,
            key: path
        };
    }

    return Object.keys(client.drives).sort(cmp_drive).map(make_drive);
}

export class DrivesPanel extends React.Component {
    render() {
        const props = this.props;
        const client = props.client;

        const drives = drive_rows(client);

        return (
            <SidePanel id="drives"
                       className="storage-drives-list"
                       title={_("Drives")}
                       empty_text={_("No drives attached")}
                       show_all_text={cockpit.format(cockpit.ngettext("Show $0 drive", "Show all $0 drives", drives.length), drives.length)}
                       rows={drives} />
        );
    }
}
