/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from "react";

import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { BundleIcon } from "@patternfly/react-icons";
import { ListingTable } from "cockpit-components-table.jsx";
import type { History as PackageKitEntry } from "_internal/packagemanager-abstract";
import * as timeformat from "timeformat";

import cockpit from "cockpit";

const _ = cockpit.gettext;

type Packages = PackageKitEntry["packages"];

function formatPkgs(pkgs: Packages) {
    const names = Object.keys(pkgs);
    names.sort();
    return names.map(n => (
        <li key={n}>
            <Tooltip content={ n + " " + pkgs[n] }>
                <span>{n}</span>
            </Tooltip>
        </li>)
    );
}

export const PackageList = ({ packages }: { packages?: Packages }) => packages ? <ul className='flow-list'>{formatPkgs(packages)}</ul> : null;

interface HistoryProps {
    packagekit: PackageKitEntry[];
}

export class History extends React.Component<HistoryProps> {
    /* Some PackageKit transactions come in pairs with identical package list,
     * but different versions. This is an internal technicality, merge them
     * together for presentation.
     *
     * Returns a time sorted (descending) list of objects like
     * { time: timestamp, num_packages: 2, packages: {names...}}
     */
    mergeHistory() {
        const history: { time: number; packages: Packages; num_packages: number }[] = [];
        let prevTime: number | undefined;
        let prevPackages: string[] | undefined;

        for (let i = 0; i < this.props.packagekit.length; ++i) {
            const packages = Object.keys(this.props.packagekit[i].packages);
            const time = this.props.packagekit[i].timestamp;
            packages.sort();

            if (prevTime && (time - prevTime) <= 600000 /* 10 mins */ &&
                prevPackages && packages &&
                prevPackages.toString() == packages.toString())
                history.pop();

            history.push({ time, packages: this.props.packagekit[i].packages, num_packages: packages.length });

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
