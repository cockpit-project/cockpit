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

import { OverlayTrigger, Tooltip } from "patternfly-react";

import cockpit from "cockpit";

const _ = cockpit.gettext;

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
        this.state = { expanded: new Set([0]) };
    }

    onExpand(index) {
        let e = new Set(this.state.expanded);
        if (e.has(index))
            e.delete(index);
        else
            e.add(index);
        this.setState({ expanded: e });
    }

    /* Some PackageKit transactions come in pairs with identical package list,
     * but different versions. This is an internal technicality, merge them
     * together for presentation.
     *
     * Returns a time sorted (descending) list of objects like
     * { time: moment_object, num_packages: 2, packages: {names...}}
     */
    mergeHistory() {
        let history = [];
        let prevTime, prevPackages;

        for (let i = 0; i < this.props.packagekit.length; ++i) {
            let packages = Object.keys(this.props.packagekit[i]).filter(i => i != "_time");
            let time = moment(this.props.packagekit[i]["_time"]);
            packages.sort();

            if (prevTime && (time - prevTime) <= 600000 /* 10 mins */ &&
                prevPackages.toString() == packages.toString())
                history.pop();

            history.push({ time, packages: this.props.packagekit[i], num_packages: packages.length });

            if (history.length === 3)
                break;

            prevPackages = packages;
            prevTime = time;
        }

        return history;
    }

    render() {
        const history = this.mergeHistory();
        if (history.length === 0)
            return null;

        let rows = history.map((update, index) => {
            const time = update.time.format("YYYY-MM-DD HH:mm");
            let pkgcount, details;

            pkgcount = (
                <div className="list-view-pf-additional-info-item">
                    <span className="pficon pficon-bundle" />
                    { cockpit.format(cockpit.ngettext("$0 Package", "$0 Packages", update.num_packages), update.num_packages) }
                </div>);

            details = (
                <tr className="listing-ct-panel">
                    <td colSpan="3">
                        <div className="listing-ct-body">
                            <PackageList packages={update.packages} />
                        </div>
                    </td>
                </tr>);

            return (
                <tbody key={index} className={ details && this.state.expanded.has(index) ? "open" : null } >
                    <tr className="listing-ct-item" onClick={ () => this.onExpand(index) } >
                        { details ? <td className="listing-ct-toggle"><i className="fa fa-fw" /></td> : <td /> }
                        <th>{time}</th>
                        <td className="history-pkgcount">{pkgcount}</td>
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
            </React.Fragment>
        );
    }
}

History.propTypes = {
    packagekit: PropTypes.arrayOf(PropTypes.object).isRequired,
};
