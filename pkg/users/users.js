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

import { debounce } from 'throttle-debounce';

import cockpit from 'cockpit';
import { superuser } from "superuser";
import { usePageLocation, useLoggedInUser, useFile, useInit } from "hooks.js";
import { etc_passwd_syntax, etc_group_syntax, etc_shells_syntax } from "pam_user_parser.js";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";

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

    useInit(async () => {
        const logind_client = cockpit.dbus("org.freedesktop.login1");

        const debouncedGetLoginDetails = debounce(100, () => {
            getLoginDetails(logind_client).then(setDetails);
        });

        /* We are mostly interested in UserNew/UserRemoved. But SessionRemoved happens immediately after logout,
         * while UserRemoved lags behind due to the "State: closing" period when the user's systemd instance
         * etc. are being cleaned up. Also, there's not that many signals and this is debounced, so just react to all
         * of them. See https://www.freedesktop.org/wiki/Software/systemd/logind/ */
        logind_client.subscribe({
            interface: "org.freedesktop.login1.Manager",
            path: "/org/freedesktop/login1",
        }, debouncedGetLoginDetails);

        let handleUtmp;

        // Watch /etc/shadow to register lock/unlock/expire changes; but avoid reading it, it's sensitive data
        const handleShadow = cockpit.file("/etc/shadow", { superuser: "try" });
        handleShadow.watch(() => debouncedGetLoginDetails(), { read: false });

        const handleLogindef = cockpit.file("/etc/login.defs");
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

        return [logind_client, handleUtmp, handleShadow, handleLogindef];
    }, [], null, handles => handles.forEach(handle => handle.close()));

    const accountsInfo = useMemo(() => {
        if (accounts && details)
            return accounts.map(account => {
                return Object.assign({}, account, details[account.name]);
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

async function getLoginDetails(logind_client) {
    const details = {};

    // currently logged in
    try {
        // out args: uso (uid, name, logind object)
        const [users] = await logind_client.call(
            "/org/freedesktop/login1", "org.freedesktop.login1.Manager", "ListUsers",
            null, { type: "", flags: "", timeout: 5000 });
        await Promise.all(users.map(async ([_, name, objpath]) => {
            const [active] = await logind_client.call(
                objpath, "org.freedesktop.DBus.Properties", "Get",
                ["org.freedesktop.login1.User", "State"],
                { type: "ss", flags: "", timeout: 5000 });
            if (active.v !== "closing")
                details[name] = { ...details[name], loggedIn: true };
        }));
    } catch (err) {
        console.warn("Unexpected error when getting logged in accounts", err);
    }

    // locked password

    // shadow-utils passwd supports an --all flag which is lacking on RHEL and
    // stable Fedora releases. Available at least on Fedora since
    // shadow-utils-4.14.0-5.fc40 (currently known as rawhide).
    try {
        const locked_statuses = await cockpit.spawn(["passwd", "-S", "--all"], { superuser: "require", err: "message", environ: ["LC_ALL=C"] });
        // Slice off the last empty line
        for (const line of locked_statuses.trim().split('\n')) {
            const name = line.split(" ")[0];
            const status = line.split(" ")[1];
            details[name] = { ...details[name], isLocked: status === "L" };
        }
    } catch (err) {
        if (err.message?.includes("bad argument --all")) {
            // Fallback for old passwd
            try {
                const shadow = await cockpit.file("/etc/shadow", { superuser: "require", err: "message" }).read();
                for (const line of shadow.split('\n')) {
                    const [name, hash] = line.split(":");
                    if (name && hash)
                        details[name] = { ...details[name], isLocked: hash.startsWith("!") };
                }
            } catch (err) {
                console.warn("Unexpected error when getting locked accounts from /etc/shadow:", err);
            }
        } else {
            console.warn("Unexpected error when getting locked account information", err);
        }
    }

    // last logged in

    let LastLogPath;
    try {
        await cockpit.spawn(["test", "-e", "/var/lib/lastlog/lastlog2.db"], { err: "ignore" });
        LastLogPath = "lastlog2";
    } catch (err1) {
        LastLogPath = "lastlog";
    }

    try {
        const out = await cockpit.spawn([LastLogPath], { environ: ["LC_ALL=C"] });
        await Promise.all(out.split('\n').slice(1, -1).map(async line => {
            if (line.includes('**Never logged in**'))
                return;

            const splitLine = line.trim().split(/[ \t]+/);
            const name = splitLine[0];
            const date_fields = splitLine.slice(-5);
            // this is impossible to parse with Date() (e.g. Firefox does not work with all time zones), so call `date` to parse it
            try {
                const out = await cockpit.spawn(["date", "+%s", "-d", date_fields.join(' ')],
                                                { environ: ["LC_ALL=C"], err: "out" });
                details[name] = { ...details[name], lastLogin: parseInt(out) * 1000 };
            } catch (e) {
                console.warn(`Failed to parse date from lastlog line '${line}': ${e.toString()}`);
            }
        }));
    } catch (ex) {
        console.warn(`Failed to run ${LastLogPath}: ${ex.toString()}`);
    }

    return details;
}

function init() {
    const root = createRoot(document.getElementById("page"));
    root.render(<AccountsPage />);
    document.body.removeAttribute("hidden");
}

document.addEventListener("DOMContentLoaded", init);
