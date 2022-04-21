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
import { Alert, Checkbox, Flex, Tooltip, TooltipPosition } from '@patternfly/react-core';
import { OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import { superuser } from "superuser";

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

        const proc = enabled
            ? cockpit.spawn(["/usr/sbin/usermod", account.name, "-G", group.name, "-a"], { superuser: "require", err: "message" })
            : cockpit.spawn(["/usr/bin/gpasswd", "-d", account.name, group.name], { superuser: "require", err: "message" });

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
        wheel:   _("Server administrator"),
        sudo:    _("Server administrator"),
        docker:  _("Container administrator"),
        weldr:   _("Image builder")
    };

    const roles = [];

    groups.forEach(group => {
        if (role_groups[group.name]) {
            roles.push(
                <Flex spaceItems={{ default: 'spaceItemsNone' }} alignItems={{ default: 'alignItemsCenter' }} key={ "flex-" + group.name }>
                    <Checkbox isDisabled={!superuser.allowed || !!changing}
                              onChange={checked => change_role(group, checked)}
                              isChecked={changing && changing.group == group.name ? changing.to : is_user_in_group(account.name, group)}
                              key={group.name}
                              id={group.name}
                              data-name={group.name}
                              label={role_groups[group.name]} />

                    <Tooltip key={ "tooltip-unix-group-" + group.name } id={ "tooltip-unix-group-" + group.name } position={ TooltipPosition.right }
                             content={ cockpit.format(_("Unix group: $0"), group.name) }>
                        <OutlinedQuestionCircleIcon className="outline-question-circle-icon" />
                    </Tooltip>
                </Flex>
            );
        }
    });

    if (changed && currently_logged_in) {
        roles.push(
            <Alert variant="info" key='alert' isInline
                   title={_("The user must log out and log back in to fully change roles.")} />
        );
    }

    return roles;
}
