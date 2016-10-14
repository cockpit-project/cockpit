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

var cockpit = require("cockpit");
var _ = cockpit.gettext;

var React = require("react");

var Select = require("cockpit-components-select.jsx");

function defaultRegisterDialogSettings() {
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
    };
}
/* Subscriptions: registration dialog body
 * Expected props:
 *   - onChange  callback to signal when the data has changed
 *   - properties as in defaultRegisterDialogSettings()
 */
var PatternDialogBody = React.createClass({
    render: function() {
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
                                <label className="control-label" for="subscription-proxy-server">
                                    {_("Server")}
                                </label>
                            </td>
                            <td><input className="form-control" id="subscription-proxy-server" type="text"
                                       placeholder="hostname:port" value={this.props.proxyServer}
                                       onChange={this.props.onChange.bind(this, 'proxyServer')}/>
                            </td>
                        </tr>

                        <tr>
                            <td>
                                <label className="control-label" for="subscription-proxy-user">
                                    {_("User")}
                                </label>
                            </td>
                            <td><input className="form-control" id="subscription-proxy-user" type="text"
                                       value={this.props.proxyUser}
                                       onChange={this.props.onChange.bind(this, 'proxyUser')}/>
                            </td>
                        </tr>

                        <tr>
                            <td>
                                <label className="control-label" for="subscription-proxy-password">
                                    {_("Password")}
                                </label>
                            </td>
                            <td><input className="form-control" id="subscription-proxy-password" type="password"
                                       value={this.props.proxyPassword}
                                       onChange={this.props.onChange.bind(this, 'proxyPassword')}/>
                            </td>
                        </tr>
                    </tbody>
                </table>
            ];
        }
        var urlEntries = {
            'default': _("Default"),
            'custom': _("Custom URL"),
        };
        return (
            <div className="modal-body">
                <table className="form-table-ct">
                    <tr>
                        <td className="top">
                            <label className="control-label" for="subscription-register-url">
                                {_("URL")}
                            </label>
                        </td>
                        <td>
                            <Select.Select key='urlSource' onChange={ this.props.onChange.bind(this, 'url') }
                                           id="subscription-register-url" initial="default">
                                <Select.SelectEntry data='default' key='default'>{ urlEntries['default'] }</Select.SelectEntry>
                                <Select.SelectEntry data='custom' key='custom'>{ urlEntries['custom'] }</Select.SelectEntry>
                            </Select.Select>
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
                                       onChange={ this.props.onChange.bind(this, 'proxy') }/>
                                {_("Use proxy server")}
                            </label>
                            {proxy}
                        </td>
                    </tr>
                    <tr>
                        <td className="top ">
                            <label className="control-label" for="subscription-register-username">
                                {_("Login")}
                            </label>
                        </td>
                        <td>
                            <input id="subscription-register-username" className="form-control" type="text"
                                   value={this.props.user}
                                   onChange={this.props.onChange.bind(this, 'user')}/>
                        </td>
                    </tr>
                    <tr>
                        <td className="top">
                            <label className="control-label" for="subscription-register-password">
                                {_("Password")}
                            </label>
                        </td>
                        <td>
                            <input id="subscription-register-password" className="form-control" type="password"
                                   value={this.props.password}
                                   onChange={this.props.onChange.bind(this, 'password')}/>
                        </td>
                    </tr>
                    <tr>
                        <td className="top">
                            <label className="control-label" for="subscription-register-key">
                                {_("Activation Key")}
                            </label>
                        </td>
                        <td>
                            <input id="subscription-register-key" className="form-control" type="text"
                                   placeholder="key_one,key_two" value={this.props.activationKeys}
                                   onChange={this.props.onChange.bind(this, 'activationKeys')}/>
                        </td>
                    </tr>
                    <tr>
                        <td className="top">
                            <label className="control-label" for="subscription-register-org">
                                {_("Organization")}
                            </label>
                        </td>
                        <td>
                            <input id="subscription-register-org" className="form-control" type="text"
                                   value={this.props.org}
                                   onChange={this.props.onChange.bind(this, 'org')}/>
                        </td>
                    </tr>
                </table>
            </div>
        );
    }
});

module.exports = {
    defaultSettings: defaultRegisterDialogSettings,
    dialogBody: PatternDialogBody,
};
