/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

import React from "react";
import ReactDOM from "react-dom";

import { OnOffSwitch } from "cockpit-components-onoff.jsx";

class OnOffDemo extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            onOffA: true,
            onOffB: false
        };
        this.onChangeA = this.onChangeA.bind(this);
        this.onChangeB = this.onChangeB.bind(this);
    }

    onChangeA(val) {
        this.setState({ onOffA: val });
    }

    onChangeB(val) {
        this.setState({ onOffB: val });
    }

    render() {
        return (
            <table>
                <tbody>
                    <tr>
                        <td><span>Regular</span></td>
                        <td><OnOffSwitch state={this.state.onOffA} onChange={this.onChangeA} /></td>
                    </tr>
                    <tr>
                        <td><span>Regular</span></td>
                        <td><OnOffSwitch state={this.state.onOffB} onChange={this.onChangeB} /></td>
                    </tr>
                    <tr>
                        <td><span>Disabled On</span></td>
                        <td><OnOffSwitch state enabled={false} /></td>
                    </tr>
                    <tr>
                        <td><span>Disabled Off</span></td>
                        <td><OnOffSwitch state={false} enabled={false} /></td>
                    </tr>
                </tbody>
            </table>
        );
    }
}

export function showOnOffDemo(rootElement) {
    ReactDOM.render(<OnOffDemo />, rootElement);
}
