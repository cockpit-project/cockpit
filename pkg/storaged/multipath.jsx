/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
import React from "react";
import { Alert, AlertActionLink } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";

import { get_multipathd_service } from "./utils.js";
import { dialog_open } from "./dialog.jsx";

const _ = cockpit.gettext;

export class MultipathAlert extends React.Component {
    constructor() {
        super();
        this.multipathd_service = get_multipathd_service();
        this.on_multipathd_changed = () => { this.setState({}) };
    }

    componentDidMount() {
        this.multipathd_service.addEventListener("changed", this.on_multipathd_changed);
    }

    componentWillUnmount() {
        this.multipathd_service.removeEventListener("changed", this.on_multipathd_changed);
    }

    render() {
        const { client } = this.props;

        // When in doubt, assume everything is alright
        const multipathd_running = !this.multipathd_service.state || this.multipathd_service.state === "running";
        const multipath_broken = client.broken_multipath_present === true;

        function activate(event) {
            if (!event || event.button !== 0)
                return;
            cockpit.spawn(["mpathconf", "--enable", "--with_multipathd", "y"],
                          { superuser: "try" })
                    .catch(function (error) {
                        dialog_open({
                            Title: _("Error"),
                            Body: error.toString()
                        });
                    });
        }

        if (multipath_broken && !multipathd_running)
            return (
                <Page>
                    <PageSection>
                        <Alert isInline variant='danger'
                            actionClose={<AlertActionLink variant='secondary' onClick={activate}>{_("Start multipath")}</AlertActionLink>}
                            title={_("There are devices with multiple paths on the system, but the multipath service is not running.")}
                        />
                    </PageSection>
                </Page>
            );
        return null;
    }
}
