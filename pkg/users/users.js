/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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
import '../lib/patternfly/patternfly-5-cockpit.scss';
import 'polyfills'; // once per application
import 'cockpit-dark-theme'; // once per page

import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import cockpit from 'cockpit';
import { superuser } from "superuser";
import { usePageLocation, useLoggedInUser, useFile, useInit } from "hooks.js";
import { etc_passwd_syntax, etc_group_syntax, etc_shells_syntax } from "pam_user_parser.js";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";

import { get_locked } from "./utils.js";
import { AccountsMain } from "./accounts-list.js";
import { AccountDetails } from "./account-details.js";

import "./users.scss";

superuser.reload_page_on_change();

export const admins = ['sudo', 'root', 'wheel'];
const sortGroups = groups => {
    return groups.sort((a, b) => {
        if (a.isAdmin)
            return -1;
        if (b.isAdmin)
            return 1;
        if (a.members === b.members)
            return a.name.localeCompare(b.name);
        else
            return b.members - a.members;
    });
};

function AccountsPage() {
    const [isGroupsExpanded, setIsGroupsExpanded] = useState(false);
    const { path } = usePageLocation();
    const accounts = useFile("/etc/passwd", { syntax: etc_passwd_syntax });
    const groups = useFile("/etc/group", { syntax: etc_group_syntax });
    const shells = useFile("/etc/shells", { syntax: etc_shells_syntax });
    const current_user_info = useLoggedInUser();

    // Handle the case where logindef == null, i.e. the file does not exist.
    // While that's unusual, "empty /etc" is a goal, and it shouldn't crash the page.
    const [min_gid, setMinGid] = useState(500);
    const [max_gid, setMaxGid] = useState(60000);
    const [min_uid, setMinUid] = useState(500);
    const [max_uid, setMaxUid] = useState(60000);
    const [details, setDetails] = useState(null);

    useInit(() => {
        // Watch `/var/run/utmp` to register when user logs in or out
        const handleUtmp = cockpit.file("/var/run/utmp", { superuser: "try", binary: true });
        handleUtmp.watch(() => getLogins().then(setDetails), { read: false });

        // Watch /etc/shadow to register lock/unlock/expire changes; but avoid reading it, it's sensitive data
        const handleShadow = cockpit.file("/etc/shadow", { superuser: "try" });
        handleShadow.watch(() => getLogins().then(setDetails), { read: false });

        const handleLogindef = cockpit.file("/etc/login.defs", { superuser: true });
        handleLogindef.watch((logindef) => {
            if (logindef === null)
                return;

            const minGid = parseInt(logindef.match(/^GID_MIN\s+(\d+)/m)[1]);
            const maxGid = parseInt(logindef.match(/^GID_MAX\s+(\d+)/m)[1]);
            const minUid = parseInt(logindef.match(/^UID_MIN\s+(\d+)/m)[1]);
            const maxUid = parseInt(logindef.match(/^UID_MAX\s+(\d+)/m)[1]);

            if (minGid)
                setMinGid(minGid);
            if (maxGid)
                setMaxGid(maxGid);
            if (minUid)
                setMinUid(minUid);
            if (maxUid)
                setMaxUid(maxUid);
        });

        return [handleUtmp, handleShadow, handleLogindef];
    }, [], null, handles => handles.forEach(handle => handle.close()));

    // lastlog uses same sorting as /etc/passwd therefore arrays can be combined based on index
    const accountsInfo = useMemo(() => {
        if (accounts && details)
            return accounts.map((account, i) => {
                return Object.assign({}, account, details[i]);
            });
        else
            return [];
    }, [accounts, details]);

    const groupsExtraInfo = useMemo(() => sortGroups(
        (groups || []).map(group => {
            const userlistPrimary = accountsInfo.filter(account => account.gid === group.gid).map(account => account.name);
            const userlist = group.userlist.filter(el => el !== "");
            return ({
                ...group,
                userlistPrimary,
                userlist,
                members: userlist.length + userlistPrimary.length,
                isAdmin: admins.includes(group.name),
                isUserCreatedGroup: group.gid >= min_gid && group.gid <= max_gid
            });
        })
    ), [groups, accountsInfo, min_gid, max_gid]);

    if (groupsExtraInfo.length == 0 || accountsInfo.length == 0) {
        return <EmptyStatePanel loading />;
    } else if (path.length === 0) {
        return (
            <AccountsMain
                accountsInfo={accountsInfo}
                current_user={current_user_info?.name}
                groups={groupsExtraInfo || []}
                isGroupsExpanded={isGroupsExpanded}
                setIsGroupsExpanded={setIsGroupsExpanded}
                min_gid={min_gid}
                max_gid={max_gid}
                min_uid={min_uid}
                max_uid={max_uid}
                shells={shells}
            />
        );
    } else if (path.length === 1) {
        return (
            <AccountDetails accounts={accountsInfo} groups={groupsExtraInfo}
                            current_user={current_user_info?.name} user={path[0]} shells={shells} />
        );
    } else return null;
}

async function getLogins() {
    let lastlog = "";
    try {
        lastlog = await cockpit.spawn(["lastlog"], { environ: ["LC_ALL=C"] });
    } catch (err) {
        console.warn("Unexpected error when getting last login information", err);
    }

    let currentLogins = [];
    try {
        const w = await cockpit.spawn(["w", "-sh"], { environ: ["LC_ALL=C"] });
        currentLogins = w.split('\n').slice(0, -1).map(line => line.split(/ +/)[0]);
    } catch (err) {
        console.warn("Unexpected error when getting logged in accounts", err);
    }

    // shadow-utils passwd supports an --all flag which is lacking on RHEL and
    // stable Fedora releases. Available at least on Fedora since
    // shadow-utils-4.14.0-5.fc40 (currently known as rawhide).
    const locked_users_map = {};
    try {
        const locked_statuses = await cockpit.spawn(["passwd", "-S", "--all"], { superuser: "require", err: "message", environ: ["LC_ALL=C"] });
        // Slice off the last empty line
        for (const line of locked_statuses.trim().split('\n')) {
            const username = line.split(" ")[0];
            const status = line.split(" ")[1];
            locked_users_map[username] = status == "L";
        }
    } catch (err) {
        // Only warn when it is unrelated to --all.
        if (err.message && !err.message.includes("bad argument --all")) {
            console.warn("Unexpected error when getting locked account information", err);
        }
    }

    // drop header and last empty line with slice
    const promises = lastlog.split('\n').slice(1, -1).map(async line => {
        const splitLine = line.split(/[ \t]+/);
        const name = splitLine[0];
        // Fallback on passwd -S for Fedora and RHEL
        const isLocked = locked_users_map[name] ?? await get_locked(name);

        if (line.indexOf('**Never logged in**') > -1) {
            return { name, loggedIn: false, lastLogin: null, isLocked };
        }

        const loggedIn = currentLogins.includes(name);

        const date_fields = splitLine.slice(-5);
        // this is impossible to parse with Date() (e.g. Firefox does not work with all time zones), so call `date` to parse it
        return cockpit.spawn(["date", "+%s", "-d", date_fields.join(' ')], { environ: ["LC_ALL=C"], err: "out" })
                .then(out => ({ name, loggedIn, lastLogin: parseInt(out) * 1000, isLocked }))
                .catch(e => console.warn(`Failed to parse date from lastlog line '${line}': ${e.toString()}`));
    });

    return Promise.all(promises);
}

function init() {
    const root = createRoot(document.getElementById("page"));
    root.render(<AccountsPage />);
    document.body.removeAttribute("hidden");
}

document.addEventListener("DOMContentLoaded", init);
