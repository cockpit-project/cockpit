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

import cockpit from "cockpit";
import React from 'react';

import {
    Alert, Button
} from '@patternfly/react-core';

import { LockIcon } from '@patternfly/react-icons';

import { SuperuserDialogs } from "../shell/superuser.jsx";

const _ = cockpit.gettext;

export class SuperuserAlert extends React.Component {
    constructor () {
        super();
        this.superuser = cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser", "/superuser");
        this.superuser.addEventListener("changed", () => { this.setState({}) });
    }

    render () {
        const actions =
            <SuperuserDialogs create_trigger={(unlocked, onclick) =>
                <Button onClick={onclick}>{_("Turn on administrative access")}</Button>}
                proxy={this.superuser}
            />;

        // The SuperuserDialogs element above needs to be in the DOM
        // regardless of the superuser level so that the dialogs are
        // not closed unexpectedly.  Thus, we merely hide the Alert
        // when it does not apply, instead of fully removing it.

        return (
            <>
                <Alert className="ct-limited-access-alert"
                       hidden={this.superuser.Current != "none"}
                       variant="warning" isInline
                       customIcon={<LockIcon />}
                       actionClose={actions}
                       title={_("Web console is running in limited access mode.")} />
            </>
        );
    }
}
