/*
 * Copyright (C) 2018 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React from "react";

import { StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Alert, AlertActionLink } from "@patternfly/react-core/dist/esm/components/Alert/index.js";

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
                <StackItem>
                    <Alert isInline variant='danger'
                           actionClose={<AlertActionLink variant='secondary' onClick={activate}>{_("Start multipath")}</AlertActionLink>}
                           title={_("There are devices with multiple paths on the system, but the multipath service is not running.")}
                    />
                </StackItem>
            );
        return null;
    }
}
