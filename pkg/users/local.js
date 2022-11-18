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
import '../lib/patternfly/patternfly-4-cockpit.scss';
import 'polyfills'; // once per application

import React from 'react';
import { createRoot } from 'react-dom/client';
import { superuser } from "superuser";

import { usePageLocation, useLoggedInUser, useFile } from "hooks.js";
import { etc_passwd_syntax, etc_group_syntax } from "./parsers.js";
import { AccountsList } from "./accounts-list.js";
import { AccountDetails } from "./account-details.js";

superuser.reload_page_on_change();

function AccountsPage() {
    const { path } = usePageLocation();
    const accounts = useFile("/etc/passwd", { syntax: etc_passwd_syntax });
    const shadow = useFile("/etc/shadow", { superuser: true });
    const groups = useFile("/etc/group", { syntax: etc_group_syntax });
    const current_user_info = useLoggedInUser();

    if (!accounts || !groups || !current_user_info)
        return null;

    if (path.length === 0)
        return <AccountsList accounts={accounts} current_user={current_user_info.name} />;
    else
        return (
            <AccountDetails accounts={accounts} groups={groups} shadow={shadow}
                            current_user={current_user_info.name} user={path[0]} />
        );
}

function init() {
    const root = createRoot(document.getElementById("page"));
    root.render(<AccountsPage />);
    document.body.removeAttribute("hidden");
}

document.addEventListener("DOMContentLoaded", init);
