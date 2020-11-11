/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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
import '../lib/patternfly/patternfly-cockpit.scss';
import 'polyfills'; // once per application

import cockpit from "cockpit";
import React from "react";
import ReactDOM from "react-dom";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";

import client from "./client";
import { MultipathAlert } from "./multipath.jsx";
import { Overview } from "./overview.jsx";
import { Details } from "./details.jsx";

import "bootstrap/dist/js/bootstrap";

import "page.scss";
import "table.css";
import "plot.css";
import "journal.css";
import "./storage.scss";

const _ = cockpit.gettext;

class StoragePage extends React.Component {
    constructor() {
        super();
        this.state = { inited: false, slow_init: false, path: cockpit.location.path };
        this.on_client_changed = () => { if (!this.props.client.busy) this.setState({}); };
        this.on_navigate = () => { this.setState({ path: cockpit.location.path }) };
    }

    componentDidMount() {
        this.props.client.addEventListener("changed", this.on_client_changed);
        cockpit.addEventListener("locationchanged", this.on_navigate);
        client.init(() => { this.setState({ inited: true }) });
        window.setTimeout(() => { if (!this.state.inited) this.setState({ slow_init: true }); }, 1000);
    }

    componentWillUnmount() {
        this.props.client.removeEventListener("changed", this.on_client_changed);
        cockpit.removeEventListener("locationchanged", this.on_navigate);
    }

    render() {
        const { client } = this.props;
        const { inited, slow_init, path } = this.state;

        if (!inited) {
            if (slow_init)
                return <EmptyStatePanel loading title={ _("Loading...") } />;
            else
                return null;
        }

        if (client.features == false || client.older_than("2.6"))
            return <EmptyStatePanel icon={ExclamationCircleIcon} title={ _("Storage can not be managed on this system.") } />;

        let detail;

        if (path.length === 0)
            detail = null;
        else if (path.length == 1)
            detail = <Details client={client} type="block" name={path[0]} />;
        else
            detail = <Details client={client} type={path[0]} name={path[1]} name2={path[2]} />;

        return (
            // We keep the Overview mounted at all times to keep the
            // plot running.  Once our plots are more React friendly,
            // we can throw this hack out.
            <>
                <MultipathAlert client={client} />
                {!detail && <Overview client={client} />}
                {detail}
            </>
        );
    }
}

function init() {
    ReactDOM.render(<StoragePage client={client} />, document.getElementById("storage"));
    document.body.removeAttribute("hidden");

    window.addEventListener('beforeunload', event => {
        if (client.busy) {
            // Firefox requires this when the page is in an iframe
            event.preventDefault();

            // see "an almost cross-browser solution" at
            // https://developer.mozilla.org/en-US/docs/Web/Events/beforeunload
            event.returnValue = '';
            return '';
        }
    });
}

document.addEventListener("DOMContentLoaded", init);
