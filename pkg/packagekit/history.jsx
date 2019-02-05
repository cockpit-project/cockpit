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

import moment from 'moment';
import React from "react";
import PropTypes from "prop-types";

import { Button, Label, DropdownKebab, MenuItem, Modal,
    OverlayTrigger, Tooltip } from "patternfly-react";

import cockpit from "cockpit";

import { snapshots } from "./snapshots.jsx";

const _ = cockpit.gettext;

const RollbackDialog = ({ time, close, onRollback }) => (
    <Modal show onHide={close}>
        <Modal.Header>
            <Modal.Title>{ _("Roll Back to Snapshot") }</Modal.Title>
        </Modal.Header>
        <Modal.Body>
            { cockpit.format(_("Are you sure you want to roll back to the system state snapshot of $0 and reboot the system?"), time) }
        </Modal.Body>
        <Modal.Footer>
            <Button bsStyle="default" className="btn-cancel" onClick={close}>{ _("Cancel")}</Button>
            <Button bsStyle="danger" onClick={ () => { close(); onRollback() } }>{ _("Roll Back and Reboot")}</Button>
        </Modal.Footer>
    </Modal>
);

function formatPkgs(pkgs) {
    let names = Object.keys(pkgs).filter(i => i != "_time");
    names.sort();
    return names.map(n => (
        <OverlayTrigger key={n} overlay={ <Tooltip id="tip-history">{ n + " " + pkgs[n] }</Tooltip> } placement="top">
            <li>{n}</li>
        </OverlayTrigger>)
    );
}

export const PackageList = ({ packages }) => packages ? <ul className='flow-list'>{formatPkgs(packages)}</ul> : null;

export class History extends React.Component {
    constructor() {
        super();
        this.state = { expanded: new Set([0]), rollbackName: null, rollbackTime: null };
        this.onSnapshotsChanged = this.onSnapshotsChanged.bind(this);
    }

    onSnapshotsChanged() {
        this.setState({});
    }

    componentDidMount() {
        snapshots.addEventListener("changed", this.onSnapshotsChanged);
        if (snapshots.rootLV) // in case it initialized before mounting
            this.onSnapshotsChanged();
    }

    componentWillUnmount() {
        snapshots.removeEventListener("changed", this.onSnapshotsChanged);
    }

    onExpand(index) {
        let e = new Set(this.state.expanded);
        if (e.has(index))
            e.delete(index);
        else
            e.add(index);
        this.setState({ expanded: e });
    }

    /* Merge snapshot and PackageKit history into a shared one. PackageKit
     * updates that can be matched to a snapshot get merged into a single
     * entry.
     *
    /* Also, some PackageKit transactions come in pairs with identical package
     * list, but different versions. This is an internal technicality, merge
     * them together for presentation.
     *
     * Returns a time sorted (descending) list of objects like
     *
     * { time: moment_object, lv_name: "update-20190211-1232", lv_size: 2147483648, lv_merging: "",
     *   num_packages: 2, packages: {names...}}
     *
     * where "lv_*" only exists for snapshots, and "packages" only exists if
     * there is a matching PackageKit update.
     */
    mergeHistory() {
        // create copy and normalize "time"
        let history = [];
        snapshots.history.map(s => history.push(Object.assign({}, s, { time: s.lv_time })));

        // limit PackageKit history to time of oldest snapshot, if snapshots are used; otherwise show 3
        let pkmax = 3;
        if (snapshots.history.length > 0) {
            let oldest = snapshots.history.reduce((oldest, s) => (oldest < s.lv_time.unix()) ? oldest : s.lv_time.unix(), undefined);
            let too_old_idx = this.props.packagekit.findIndex(pkgs => pkgs["_time"] / 1000 < oldest);
            pkmax = (too_old_idx >= 0) ? Math.min(too_old_idx, pkmax) : null;
        }

        // copy, normalize, and clean out PackageKit history
        let prevTime, prevPackages;
        for (let i = 0; i < this.props.packagekit.length; ++i) {
            let packages = Object.keys(this.props.packagekit[i]).filter(i => i != "_time");
            let time = moment(this.props.packagekit[i]["_time"]);
            packages.sort();

            if (prevTime && (time - prevTime) <= 600000 /* 10 mins */ &&
                prevPackages.toString() == packages.toString())
                history.pop();

            history.push({ time, packages: this.props.packagekit[i], num_packages: packages.length });

            if (history.length === pkmax)
                break;

            prevPackages = packages;
            prevTime = time;
        }

        // sort by descending time
        history.sort((u1, u2) => u2.time - u1.time);

        // merge each PackageKit update that is followed by a snapshot
        for (let i = 0; i < history.length - 1; ++i) {
            if (history[i].packages && history[i + 1].lv_name)
                Object.assign(history[i], history.splice(i + 1, 1)[0]);
        }

        return history;
    }

    render() {
        const history = this.mergeHistory();
        if (history.length === 0)
            return null;

        const pending_rollback = snapshots.history.find(s => !!s.lv_merging);

        let rows = history.map((update, index) => {
            const time = update.time.format("YYYY-MM-DD HH:mm");
            let pkgcount, snapsize, rollback_action, kebab_action, details;

            if (update.lv_merging) {
                rollback_action = <Label bsStyle="info">{ _("Restoring...") }</Label>;
            } else if (update.lv_name) {
                // if there is a pending rollback, one cannot apply more rollbacks
                if (!pending_rollback)
                    rollback_action = (
                        <Button onClick={ event => {
                            this.setState({ rollbackName: update.lv_name, rollbackTime: time });
                            event.stopPropagation();
                        } } >
                            { _("Roll Back") }
                        </Button>);

                kebab_action = (
                    // HACK: DropdownKebab uses react-bootstrap's Dropdown, whose handleClick() forgets to stop
                    // event propagation in version <= 0.32.4. So stop it in here the parent element instead. This
                    // code change in react-bootstrap 1.0.0, but that version doesn't yet work with PF-React.
                    <span className="history-kebab" onClick={ ev => ev.stopPropagation() }>
                        <DropdownKebab key="actions" id={ "actions-" + update.lv_name } pullRight>
                            <MenuItem onClick={ () => snapshots.delete(update.lv_name) }>{ _("Delete Snapshot") }</MenuItem>
                        </DropdownKebab>
                    </span>);
            }

            if (update.lv_size) {
                snapsize = (
                    <div className="list-view-pf-additional-info-item">
                        <span className="pficon pficon-restart" />
                        { cockpit.format(_("$0 Snapshot"), cockpit.format_bytes(update.lv_size, 1024)) }
                    </div>);
            }

            if (update.packages) {
                pkgcount = (
                    <div className="list-view-pf-additional-info-item">
                        <span className="pficon pficon-bundle" />
                        { cockpit.format(cockpit.ngettext("$0 Package", "$0 Packages", update.num_packages), update.num_packages) }
                    </div>);

                details = (
                    <tr className="listing-ct-panel">
                        <td colSpan="6">
                            <div className="listing-ct-body">
                                <PackageList packages={update.packages} />
                            </div>
                        </td>
                    </tr>);
            }

            return (
                <tbody key={index} className={ details && this.state.expanded.has(index) ? "open" : null } >
                    <tr className="listing-ct-item" onClick={ () => this.onExpand(index) } >
                        { details ? <td className="listing-ct-toggle"><i className="fa fa-fw" /></td> : <td /> }
                        <th>{time}</th>
                        <td className="listing-ct-meta">
                            <div className="history-pkgcount listing-ct-info">{pkgcount}</div>
                            <div className="history-snapsize listing-ct-info">{snapsize}</div>
                            <div className="history-rollback listing-ct-action">
                                {rollback_action}
                                {kebab_action}
                            </div>
                        </td>
                    </tr>
                    {details}
                </tbody>);
        });

        return (
            <React.Fragment>
                <h2>{ _("Update History") }</h2>
                <table className="listing-ct updates-history">
                    {rows}
                </table>

                { this.state.rollbackName &&
                    <RollbackDialog time={this.state.rollbackTime}
                                    close={ () => this.setState({ rollbackName: null }) }
                                    onRollback={ () => snapshots.rollback(this.state.rollbackName) } /> }
            </React.Fragment>
        );
    }
}

History.propTypes = {
    packagekit: PropTypes.arrayOf(PropTypes.object).isRequired,
};
