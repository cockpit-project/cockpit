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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import React from "react";
import PropTypes from "prop-types";

import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { BundleIcon } from "@patternfly/react-icons";
import { ListingTable } from "cockpit-components-table.jsx";
import * as timeformat from "timeformat";

import cockpit from "cockpit";

const _ = cockpit.gettext;

function formatPkgs(pkgs) {
    const names = Object.keys(pkgs).filter(i => i != "_time");
    names.sort();
    return names.map(n => {
        const tooltipRef = React.useRef(null);

        return (
            <React.Fragment key={n}>
                <li ref={tooltipRef}>{n}</li>
                <Tooltip triggerRef={tooltipRef} content={ n + " " + pkgs[n] } />
            </React.Fragment>
        );
    });
}

export const PackageList = ({ packages }) => packages ? <ul className='flow-list'>{formatPkgs(packages)}</ul> : null;

export class History extends React.Component {
    /* Some PackageKit transactions come in pairs with identical package list,
     * but different versions. This is an internal technicality, merge them
     * together for presentation.
     *
     * Returns a time sorted (descending) list of objects like
     * { time: timestamp, num_packages: 2, packages: {names...}}
     */
    mergeHistory() {
        const history = [];
        let prevTime, prevPackages;

        for (let i = 0; i < this.props.packagekit.length; ++i) {
            const packages = Object.keys(this.props.packagekit[i]).filter(i => i != "_time");
            const time = this.props.packagekit[i]._time;
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
            const pkgcount = (
                <div className="list-view-pf-additional-info-item">
                    <BundleIcon />
                    { cockpit.format(cockpit.ngettext("$0 package", "$0 packages", update.num_packages), update.num_packages) }
                </div>);

            const expandedContent = <PackageList packages={update.packages} />;

            return ({
                props: { key: update.time },
                columns: [
                    { title: timeformat.dateTime(update.time), props: { className: "history-time" } },
                    { title: pkgcount, props: { className: "history-pkgcount" } },
                ],
                initiallyExpanded: index == 0,
                hasPadding: true,
                expandedContent
            });
        });

        return (
            <ListingTable aria-label={_("Updates history")}
                          showHeader={false}
                          className="updates-history"
                          columns={[_("Time"), _("History package count")]}
                          rows={rows} />
        );
    }
}

History.propTypes = {
    packagekit: PropTypes.arrayOf(PropTypes.object).isRequired,
};
