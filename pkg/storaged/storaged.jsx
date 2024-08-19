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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import '../lib/patternfly/patternfly-5-cockpit.scss';
import 'polyfills'; // once per application
import 'cockpit-dark-theme'; // once per page

import cockpit from "cockpit";
import React from "react";
import { createRoot } from 'react-dom/client';
import { ExclamationCircleIcon } from "@patternfly/react-icons";

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { PlotState } from "plot.js";

import client from "./client";
import { update_plot_state } from "./plot.jsx";
import { StoragePage } from "./pages.jsx";

import "./storage.scss";

const _ = cockpit.gettext;

class Application extends React.Component {
    constructor() {
        super();
        this.state = { inited: false, slow_init: false, path: cockpit.location.path };
        this.plot_state = new PlotState();
        this.on_client_changed = () => { if (!client.busy) this.setState({}); };
        this.on_navigate = () => { this.setState({ path: cockpit.location.path }) };
    }

    componentDidMount() {
        client.addEventListener("changed", this.on_client_changed);
        cockpit.addEventListener("locationchanged", this.on_navigate);
        client.init(() => { this.setState({ inited: true }) });
        window.setTimeout(() => { if (!this.state.inited) this.setState({ slow_init: true }); }, 1000);
    }

    componentWillUnmount() {
        client.removeEventListener("changed", this.on_client_changed);
        cockpit.removeEventListener("locationchanged", this.on_navigate);
    }

    render() {
        const { inited, slow_init, path } = this.state;

        if (!inited) {
            if (slow_init)
                return <EmptyStatePanel loading title={ _("Loading...") } />;
            else
                return null;
        }

        if (client.features == false || client.older_than("2.6"))
            return <EmptyStatePanel icon={ExclamationCircleIcon} title={ _("Storage can not be managed on this system.") } />;

        // We maintain the plot state here so that the plots stay
        // alive no matter what page is shown.
        update_plot_state(this.plot_state, client);

        return <StoragePage location={path} plot_state={this.plot_state} />;
    }
}

function init() {
    const root = createRoot(document.getElementById('storage'));
    root.render(<Application />);
    document.body.removeAttribute("hidden");

    window.addEventListener('beforeunload', event => {
        if (client.busy) {
            // Firefox requires this when the page is in an iframe
            event.preventDefault();

            // see "an almost cross-browser solution" at
            // https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
            event.returnValue = '';
            return '';
        }
    });
}

document.addEventListener("DOMContentLoaded", init);
