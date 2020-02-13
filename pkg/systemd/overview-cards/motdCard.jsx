/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React from 'react';

import cockpit from "cockpit";

import './motdCard.scss';

export class MotdCard extends React.Component {
    constructor() {
        super();
        this.state = { motdText: "", motdVisible: false };
    }

    componentDidMount() {
        cockpit.file("/etc/motd").watch(content => {
            if (content)
                content = content.trimRight();
            if (content && content != cockpit.localStorage.getItem('dismissed-motd')) {
                this.setState({ motdText: content, motdVisible: true });
            } else {
                this.setState({ motdVisible: false });
            }
        });
    }

    render() {
        if (!this.state.motdVisible)
            return null;

        return (
            <div id="motd-box" className="motd-box">
                <div className="pf-c-alert pf-m-info pf-m-inline" aria-label="Info alert">
                    <div className="pf-c-alert__icon">
                        <i className="fa fa-info-circle" aria-hidden="true" />
                    </div>
                    <h4 className="pf-c-alert__title">
                        <pre id="motd">{this.state.motdText}</pre>
                    </h4>
                    <div className="pf-c-alert__action">
                        <button className="pf-c-button pf-m-plain" type="button" onClick={() => {
                            this.setState({ motdVisible: false });
                            cockpit.localStorage.setItem('dismissed-motd', this.state.motdText);
                        }}>
                            <i className="fa fa-times" aria-hidden="true" />
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
