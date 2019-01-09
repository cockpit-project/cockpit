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

import cockpit from "cockpit";
import React from "react";
import ReactDOM from "react-dom";

import client from "./client";
import { MultipathAlert } from "./multipath.jsx";
import { Overview } from "./overview.jsx";
import { Details } from "./details.jsx";

import "page.css";
import "table.css";
import "plot.css";
import "journal.css";
import "./storage.css";

const _ = cockpit.gettext;

class StoragePage extends React.Component {
    constructor() {
        super();
        this.state = { path: cockpit.location.path };
        this.on_client_changed = () => { this.setState({}) };
        this.on_navigate = () => { this.setState({ path: cockpit.location.path }) };
    }

    componentDidMount() {
        this.props.client.addEventListener("changed", this.on_client_changed);
        cockpit.addEventListener("locationchanged", this.on_navigate);
    }

    componentWillUnmount() {
        this.props.client.removeEventListener("changed", this.on_client_changed);
        cockpit.removeEventListener("locationchanged", this.on_navigate);
    }

    render() {
        const { client } = this.props;
        const { path } = this.state;

        if (client.features == false) {
            return (
                <div className="curtains-ct blank-slate-pf">
                    <h1>{_("Storage can not be managed on this system.")}</h1>
                </div>
            );
        }

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
            <React.Fragment>
                <MultipathAlert client={client} />
                <div className={detail ? "hidden" : null}><Overview client={client} /></div>
                {detail}
            </React.Fragment>
        );
    }
}

function init() {
    client.init(() => {
        ReactDOM.render(<StoragePage client={client} />, document.getElementById("storage"));
        document.body.style.display = "block";
    });
}

document.addEventListener("DOMContentLoaded", init);
