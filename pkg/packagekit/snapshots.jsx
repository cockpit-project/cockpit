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

import moment from "moment";
import React from "react";

import { Button, Modal, Alert, OverlayTrigger, Tooltip } from "patternfly-react";

import cockpit from "cockpit";
import 'form-layout.less';

const _ = cockpit.gettext;
const LVM_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss Z";
const GiB = 1024 * 1024 * 1024;

function debug() {
    if (window.debugging == "all" || window.debugging == "packagekit")
        console.log.apply(console, arguments);
}

/*
 *
 * Snapshots management object
 *
 */

export var snapshots = {
    rootLV: null,
    VG: null,
    availableSpace: 0,
    usedSpace: null,
    sizeGiB: null,
    history: [], // objects with lv_name, lv_time (moment object), lv_size, lv_merging (see lvmreport(7))
};

snapshots.init = () => {
    // check if root device is on LVM
    cockpit.spawn(["findmnt", "--noheadings", "--output", "SOURCE", "/"], { err: "message" })
            .then(rootdev => {
                rootdev = rootdev.trim();
                debug("findmnt /:", rootdev);
                if (rootdev.startsWith("/dev/mapper/")) {
                    // check available and used space
                    Promise.all([
                        cockpit.spawn(["lvdisplay", "--noheadings", "--columns", "--units=b", "--nosuffix", "-ovg_free,vg_name,lv_name", rootdev],
                                      { err: "message", superuser: "require" }),
                        cockpit.spawn(["df", "--block-size=1", "--output=used", "/"], { err: "message" })
                    ])
                            .then(outputs => {
                                let fields = outputs[0].trim().split(' ');
                                let avail = parseInt(fields[0]);
                                snapshots.VG = fields[1];
                                let lv_name = fields[2];

                                // df output looks like "   Used\n12345\n"
                                let used = parseInt(outputs[1].trim().split('\n')[1]);
                                debug("free space on root VG", snapshots.VG, ":", avail, "used space on root fs:", used);
                                snapshots.rootLV = rootdev;
                                snapshots.availableSpace = avail;
                                snapshots.usedSpace = used;
                                // default size to used space on root fs
                                snapshots.sizeGiB = Math.round(used / GiB);

                                snapshots.dispatchEvent("changed");

                                // get existing snapshots
                                cockpit.spawn(["lvs", "--reportformat=json", "--all", "--units=b", "--nosuffix",
                                    "--options=lv_name,lv_time,lv_size,lv_attr,lv_merging",
                                    "--select", "lv_attr=~^[sS] && origin=" + lv_name, snapshots.VG],
                                              { err: "message", superuser: "require" })
                                        .then(output => {
                                            let info = JSON.parse(output);
                                            // parse lv_time
                                            snapshots.history = info.report[0].lv.map(s => {
                                                s.lv_time = moment(s.lv_time, LVM_TIME_FORMAT, true);
                                                return s;
                                            });
                                            debug("snapshot history:", JSON.stringify(snapshots.history));
                                            snapshots.dispatchEvent("changed");
                                        })
                                        .catch(error => {
                                            console.warn("failed to list existing snapshots:", JSON.stringify(error));
                                        });
                            })
                            .catch(error => {
                                console.warn("failed to determine available and free space:", JSON.stringify(error));
                            });
                }
            })
            .catch(error => {
                debug("findmnt / failed: ", error);
            });
};

snapshots.create = () => {
    if (!snapshots.rootLV)
        return Promise.reject(new Error("There is no LVM root LV, snapshots not available"));

    const name = "update-" + moment().format("YYYYMMDD-HHmm");

    debug("creating snapshot", name, "with size", snapshots.sizeGiB, "GiB on", snapshots.rootLV);

    let pr = cockpit.spawn(["lvcreate", "--snapshot", "-n", name, "--size", snapshots.sizeGiB + "G", snapshots.rootLV],
                           { err: "message", superuser: "require" });
    pr.then(() => snapshots.init());
    return pr;
};

snapshots.delete = (name) => {
    debug("deleting snapshot", name);
    let pr = cockpit.spawn(["lvremove", "--force", snapshots.VG + "/" + name],
                           { err: "message", superuser: "require" });
    pr.then(() => snapshots.init());
    return pr;
};

snapshots.rollback = (name) => {
    debug("rolling back to snapshot", name);
    return cockpit.spawn(["lvconvert", "--merge", snapshots.VG + "/" + name],
                         { err: "message", superuser: "require" })
            .then(() => {
                // quick UI update, until it disconnects due to rebooting
                snapshots.init();
                debug("rebooting to apply snapshot", name);
                cockpit.spawn(["shutdown", "--reboot", "now"], { superuser: "require", err: "message" })
                        .fail(error => console.error("Failed to reboot:", error.toString()));
            });
};

cockpit.event_target(snapshots);
snapshots.init();

/*
 *
 * Snapshot creation dialog
 *
 */

class SnapshotCreateDialog extends React.Component {
    constructor() {
        super();
        this.state = { sizeGiB: snapshots.sizeGiB, error: null };
        this.onSizeChange = this.onSizeChange.bind(this);
        this.onUpdate = this.onUpdate.bind(this);
    }

    onSizeChange(event) {
        let n = parseInt(event.target.value);
        if (!isNaN(n))
            this.setState({ sizeGiB: n });
    }

    onUpdate() {
        snapshots.sizeGiB = this.state.sizeGiB;
        snapshots.create()
                .then(() => {
                    this.setState({ error: null });
                    this.props.close();
                })
                .catch(err => this.setState({ error: err.toString() }));
    }

    render() {
        return (
            <Modal id="create-snapshot-dialog" show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.Title>{ _("Create Snapshot") }</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>{ _("The snapshot must be big enough to contain all future updates and changes to the root volume.") }</p>

                    <form className="ct-form-layout">
                        <label className="control-label" htmlFor="create-snapshot-size">{ _("Snapshot Size") }</label>
                        <div role="group">
                            <input id="create-snapshot-size" type="number" value={this.state.sizeGiB} onChange={this.onSizeChange}
                                   min={1} max={ Math.floor(snapshots.availableSpace / 1000000000) } />
                            <label>GiB</label>
                        </div>
                    </form>
                </Modal.Body>
                <Modal.Footer>
                    { this.state.error && <Alert><span>{this.state.error}</span></Alert> }
                    <Button bsStyle="default" className="btn-cancel" onClick={this.props.close}>{ _("Cancel")}</Button>
                    <Button bsStyle="primary" onClick={this.onUpdate}>{ _("Create")}</Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

/*
 *
 * Snapshots creation button
 *
 */

export class SnapshotCreateButton extends React.Component {
    constructor() {
        super();
        this.state = { showDialog: false };
        this.onSnapshotsChanged = this.onSnapshotsChanged.bind(this);
    }

    onSnapshotsChanged() {
        this.setState({ });
        debug("SnapshotCreateButton.onSnapshotsChanged", JSON.stringify(snapshots));
    }

    componentDidMount() {
        snapshots.addEventListener("changed", this.onSnapshotsChanged);
        if (snapshots.rootLV) // in case it initialized before mounting
            this.onSnapshotsChanged();
    }

    componentWillUnmount() {
        snapshots.removeEventListener("changed", this.onSnapshotsChanged);
    }

    render() {
        if (!snapshots.rootLV)
            return null;

        let button;
        const button_label = _("Create Snapshot");
        if (snapshots.availableSpace < snapshots.usedSpace) {
            const tooltip = cockpit.format(_("The $0 volume group does not have enough free space to create snapshots."), snapshots.VG);

            button = (
                <OverlayTrigger overlay={ <Tooltip id="tip-snapshots-nospc">{tooltip}</Tooltip> } placement="bottom">
                    <button className="pk-update--snapshot btn btn-default" disabled>
                        {button_label}
                    </button>
                </OverlayTrigger>);
        } else {
            button = (
                <button className="pk-update--snapshot btn btn-default" onClick={ () => this.setState({ showDialog: true }) }>
                    {button_label}
                </button>);
        }

        return (
            <React.Fragment>
                {button}
                { this.state.showDialog &&
                    <SnapshotCreateDialog close={ () => this.setState({ showDialog: false }) } />
                }
            </React.Fragment>
        );
    }
}
