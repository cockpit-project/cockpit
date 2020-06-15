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

import { Tooltip } from "@patternfly/react-core";

import cockpit from "cockpit";

const _ = cockpit.gettext;

function formatPkgs(pkgs) {
    const names = Object.keys(pkgs).filter(i => i != "_time");
    names.sort();
    return names.map(n => (
        <Tooltip key={n} id="tip-history" content={ n + " " + pkgs[n] }>
            <li>{n}</li>
        </Tooltip>)
    );
}

export const PackageList = ({ packages }) => packages ? <ul className='flow-list'>{formatPkgs(packages)}</ul> : null;

export class History extends React.Component {
    constructor() {
        super();
        this.state = { expanded: new Set([0]) };
    }

    onExpand(index) {
        const e = new Set(this.state.expanded);
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
        const history = [];
        let prevTime, prevPackages;

        for (let i = 0; i < this.props.packagekit.length; ++i) {
            const packages = Object.keys(this.props.packagekit[i]).filter(i => i != "_time");
            const time = moment(this.props.packagekit[i]._time);
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

        const rows = history.map((update, index) => {
            const time = update.time.format("YYYY-MM-DD HH:mm");

            const pkgcount = (
                <div className="list-view-pf-additional-info-item">
                    <span className="pficon pficon-bundle" />
                    { cockpit.format(cockpit.ngettext("$0 Package", "$0 Packages", update.num_packages), update.num_packages) }
                </div>);

            const details = (
                <tr className="listing-ct-panel">
                    <td colSpan="3">
                        <div className="listing-ct-body">
                            <PackageList packages={update.packages} />
                        </div>
                    </td>
                </tr>);

            return (
                <tbody key={index} className={ details && this.state.expanded.has(index) ? "open" : null }>
                    <tr className="listing-ct-item" onClick={ () => this.onExpand(index) }>
                        { details ? <td className="listing-ct-toggle"><i className="fa fa-fw" /></td> : <td /> }
                        <th>{time}</th>
                        <td className="history-pkgcount">{pkgcount}</td>
                    </tr>
                    {details}
                </tbody>);
        });

        return (
            <>
                <h2>{ _("Update History") }</h2>
                <table className="listing-ct updates-history">
                    {rows}
                </table>
            </>
        );
    }
}

History.propTypes = {
    packagekit: PropTypes.arrayOf(PropTypes.object).isRequired,
};
