/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

import cockpit from 'cockpit';
import React, { useState } from 'react';
import { Tooltip, TooltipPosition } from '@patternfly/react-core';
import { superuser } from "superuser.jsx";

import { show_unexpected_error } from "./dialog-utils.js";

const _ = cockpit.gettext;

function is_user_in_group(user, group) {
    return !!(group.userlist && group.userlist.find(u => u == user));
}

export function AccountRoles({ account, groups, currently_logged_in }) {
    const [changing, setChanging] = useState(null);
    const [changed, setChanged] = useState(false);

    function change_role(group, enabled) {
        setChanging({ group: group.name, to: enabled });

        var proc;
        if (enabled) {
            proc = cockpit.spawn(["/usr/sbin/usermod", account.name, "-G", group.name, "-a"],
                                 { superuser: "require", err: "message" });
        } else {
            proc = cockpit.spawn(["/usr/bin/gpasswd", "-d", account.name, group.name],
                                 { superuser: "require", err: "message" });
        }

        proc
                .then(() => {
                    setChanging(null);
                    setChanged(true);
                })
                .catch(error => {
                    setChanging(null);
                    show_unexpected_error(error);
                });
    }

    const role_groups = {
        wheel:   _("Server Administrator"),
        sudo:    _("Server Administrator"),
        docker:  _("Container Administrator"),
        weldr:   _("Image Builder")
    };

    var roles = [];

    groups.forEach(group => {
        if (role_groups[group.name]) {
            roles.push(
                <div key={group.name} className="checkbox">
                    <Tooltip id={ "tooltip-unix-group-" + group.name } position={ TooltipPosition.right }
                             content={ cockpit.format(_("Unix group: $0"), group.name) }>
                        <label>
                            <input type="checkbox" disabled={!superuser.allowed || !!changing}
                            onChange={event => change_role(group, event.target.checked)}
                checked={changing && changing.group == group.name ? changing.to : is_user_in_group(account.name, group)}
                data-name={group.name} />
                            {role_groups[group.name]}
                        </label>
                    </Tooltip>
                </div>);
        }
    });

    if (changed && currently_logged_in) {
        roles.push(
            <div key="alert" className="pf-c-alert pf-m-info pf-m-inline" aria-label="inline info alert">
                <div className="pf-c-alert__icon">
                    <i className="fa fa-info-circle" aria-hidden="true" />
                </div>
                <h4 className="pf-c-alert__title">{_("The user must log out and log back in to fully change roles.")}</h4>
            </div>);
    }

    return roles;
}
