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
import cockpit from "cockpit";

import * as Select from "cockpit-components-select.jsx";

import { client } from "./subscriptions-client";
import * as Insights from './insights.jsx';

const _ = cockpit.gettext;

export function defaultSettings() {
    return {
        url: 'default',
        serverUrl: 'subscription.rhn.redhat.com',
        proxy: false,
        proxyServer: '',
        proxyUser: '',
        proxyPassword: '',
        user: '',
        password: '',
        activationKeys: '',
        org: '',
        insights: false,
        insights_available: client.insightsAvailable,
        insights_detected: false
    };
}
/* Subscriptions: registration dialog body
 * Expected props:
 *   - onChange  callback to signal when the data has changed
 *   - properties as in defaultRegisterDialogSettings()
 */
export class DialogBody extends React.Component {
    render() {
        var customURL;
        if (this.props.url == 'custom') {
            customURL = (
                <input id="subscription-register-url-custom" className="form-control" type="text"
                    value={this.props.serverUrl} onChange={this.props.onChange.bind(this, 'serverUrl')} />
            );
        }
        var proxy;
        if (this.props.proxy) {
            proxy = [
                <br />,
                <table className="form-group-ct">
                    <tbody>
                        <tr>
                            <td>
                                <label className="control-label" htmlFor="subscription-proxy-server">
                                    {_("Server")}
                                </label>
                            </td>
                            <td><input className="form-control" id="subscription-proxy-server" type="text"
                                       placeholder="hostname:port" value={this.props.proxyServer}
                                       onChange={this.props.onChange.bind(this, 'proxyServer')} />
                            </td>
                        </tr>

                        <tr>
                            <td>
                                <label className="control-label" htmlFor="subscription-proxy-user">
                                    {_("User")}
                                </label>
                            </td>
                            <td><input className="form-control" id="subscription-proxy-user" type="text"
                                       value={this.props.proxyUser}
                                       onChange={this.props.onChange.bind(this, 'proxyUser')} />
                            </td>
                        </tr>

                        <tr>
                            <td>
                                <label className="control-label" htmlFor="subscription-proxy-password">
                                    {_("Password")}
                                </label>
                            </td>
                            <td><input className="form-control" id="subscription-proxy-password" type="password"
                                       value={this.props.proxyPassword}
                                       onChange={this.props.onChange.bind(this, 'proxyPassword')} />
                            </td>
                        </tr>
                    </tbody>
                </table>
            ];
        }

        var insights;
        if (this.props.insights_available) {
            insights =
                <tr>
                    <td className="top">
                        <label className="control-label" htmlFor="subscription-insights">
                            {_("Insights")}
                        </label>
                    </td>
                    <td>
                        <label key="1" className="checkbox-inline">
                            <input id="subscription-insights" type="checkbox" checked={this.props.insights}
            onChange={this.props.onChange.bind(this, 'insights')} />
                            <span>
                                { Insights.fmt_to_fragments(_("Connect this system to $0."), Insights.link) }
                            </span>
                        </label>
                        { (this.props.insights && !this.props.insights_detected) && <p>{ Insights.fmt_to_fragments(_("The $0 package will be installed."), <strong>{client.insightsPackage}</strong>)}</p> }
                    </td>
                </tr>;
        }

        var urlEntries = {
            'default': _("Default"),
            'custom': _("Custom URL"),
        };
        return (
            <div className="modal-body">
                <table className="form-table-ct">
                    <tbody>
                        <tr>
                            <td className="top">
                                <label className="control-label" htmlFor="subscription-register-url">
                                    {_("URL")}
                                </label>
                            </td>
                            <td>
                                <Select.StatelessSelect key='urlSource'
                                                        onChange={ this.props.onChange.bind(this, 'url') }
                                                        id="subscription-register-url"
                                                        selected={this.props.url}>
                                    <Select.SelectEntry data='default' key='default'>{ urlEntries['default'] }</Select.SelectEntry>
                                    <Select.SelectEntry data='custom' key='custom'>{ urlEntries['custom'] }</Select.SelectEntry>
                                </Select.StatelessSelect>
                                {customURL}
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label">
                                    {_("Proxy")}
                                </label>
                            </td>
                            <td>
                                <label>
                                    <input id="subscription-proxy-use" type="checkbox" checked={this.props.proxy}
                                           onChange={ this.props.onChange.bind(this, 'proxy') } />
                                    {_("Use proxy server")}
                                </label>
                                {proxy}
                            </td>
                        </tr>
                        <tr>
                            <td className="top ">
                                <label className="control-label" htmlFor="subscription-register-username">
                                    {_("Login")}
                                </label>
                            </td>
                            <td>
                                <input id="subscription-register-username" className="form-control" type="text"
                                       value={this.props.user}
                                       onChange={this.props.onChange.bind(this, 'user')} />
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label" htmlFor="subscription-register-password">
                                    {_("Password")}
                                </label>
                            </td>
                            <td>
                                <input id="subscription-register-password" className="form-control" type="password"
                                       value={this.props.password}
                                       onChange={this.props.onChange.bind(this, 'password')} />
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label" htmlFor="subscription-register-key">
                                    {_("Activation Key")}
                                </label>
                            </td>
                            <td>
                                <input id="subscription-register-key" className="form-control" type="text"
                                       placeholder="key_one,key_two" value={this.props.activationKeys}
                                       onChange={this.props.onChange.bind(this, 'activationKeys')} />
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label" htmlFor="subscription-register-org">
                                    {_("Organization")}
                                </label>
                            </td>
                            <td>
                                <input id="subscription-register-org" className="form-control" type="text"
                                       value={this.props.org}
                                       onChange={this.props.onChange.bind(this, 'org')} />
                            </td>
                        </tr>
                        { insights }
                    </tbody>
                </table>
            </div>
        );
    }
}
