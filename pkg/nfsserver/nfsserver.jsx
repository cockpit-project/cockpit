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

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");
    var React = require("react");

    var dialog_view = require("cockpit-components-dialog.jsx");
    var CockpitListing = require("cockpit-components-listing.jsx");
    var ansible = require("./ansible");

    var init_script = require("raw!./init-role.sh");

    var _ = cockpit.gettext;

    require("page.css");
    require("table.css");

    var OnOffButton = React.createClass({
        getInitialState: function () {
            return { wanted: null };
        },
        onToggle: function () {
            var self = this;
            var wanted = !self.props.value;
            self.setState({ wanted: wanted });
            self.props.ontoggle(wanted).always(function () {
                self.setState({ wanted: null });
            });
        },
        render: function () {
            var on_class = "btn", off_class = "btn";
            var on_onclick, off_onclick;
            var toggle = this.onToggle;

            if (this.props.disabled) {
                toggle = null;
                on_class += " disabled";
                off_class += " disabled";
            } else if (this.state.wanted !== null && this.state.wanted != this.props.value) {
                // same as disabled for now
                toggle = null;
                on_class += " disabled";
                off_class += " disabled";
            }

            var val = (this.state.wanted == null)? this.props.value : this.state.wanted;

            if (val) {
                on_class += " active";
                off_onclick = toggle;
            } else {
                off_class += " active";
                on_onclick = toggle;
            }

            return (
                <div className="btn-onoff-ct btn-group">
                    <label className={on_class} onclick={on_onclick}>{_("On")}</label>
                    <label className={off_class} onclick={off_onclick}>{_("Off")}</label>
                </div>
            );
        }
    });

    var ShareTab = React.createClass({
        render: function () {
            return (
                <table className="info-table-ct">
                    <tr>
                        <td>{_("Folder")}</td>
                        <td>{this.props.key_}</td>
                    </tr>
                </table>
            );
        }
    });

    var SharesPanel = React.createClass({
        onAdd: function () {
            share_dialog(this.props.role, null);
        },
        onEnabledToggle: function (value) {
            return this.props.role.set({ enabled: value });
        },
        render: function () {
            var role = this.props.role;
            var shares = (role.parameters && role.parameters.shares) || { };
            var keys = Object.keys(shares);

            var actions = [
                <OnOffButton value={this.props.role.parameters.enabled}
                             ontoggle={this.onEnabledToggle}/>,
                <div className="pull-right">
                    <a onclick={this.onAdd}>
                        <span className="pficon pficon-add-circle-o"></span> {_("Add New Share")}
                    </a>
                </div>
            ];

            return (
                <CockpitListing.Listing title={_("Sharing") + " "}
                                        actions={actions}
                                        emptyCaption={_("No Shares Defined")}>
                    {
                        keys.map(function (key) {
                            var share = shares[key];

                            function onedit(event) {
                                share_dialog(role, key);
                            };

                            function onremove(event) {
                                var shares = $.extend({}, role.parameters.shares);
                                delete shares[key];
                                role.set({ shares: shares });
                            };

                            var tab_data = {
                                key_: key,
                                share: share
                            };

                            var tabs = [
                                { name: _("Share"), renderer: ShareTab, data: tab_data }
                            ];

                            var cols = [
                                { name: key, 'header': true }
                            ];

                            var actions = [
                                <button className="btn btn-default pficon pficon-edit"
                                        onclick={onedit}>
                                </button>,
                                <button className="btn btn-danger pficon pficon-delete"
                                        onclick={onremove}>
                                </button>
                            ];

                            return (
                                <CockpitListing.ListingRow key={key}
                                                           columns={cols}
                                                           tabRenderers={tabs}
                                                           listingActions={actions}/>
                            );
                        })
                    }
                </CockpitListing.Listing>
            );
        }
    });

    var Validated = React.createClass({
        render: function () {
            var error = this.props.errors && this.props.errors[this.props.error_key];
            // We need to always render the <div> for the has-error
            // class so that the input field keeps the focus when
            // errors are cleared.  Otherwise the DOM changes enough
            // for the Browser to remove focus.
            return (
                <div className={error? "has-error" : ""}>
                    {this.props.children}
                    {error? <span className="help-block">{error}</span> : null}
                </div>
            );
        }
    });

    var ShareDialog = React.createClass({
        getInitialState: function () {
            return { key: this.props.key_,
                     share: this.props.share };
        },
        onKeyChange: function (event) {
            this.setState({ key: event.target.value });
            this.props.onchanged(this.state.key, this.state.share);
        },
        render: function () {
            return (
                <table className="form-table-ct">
                    <tr>
                        <td className="top">Folder</td>
                        <td>
                            <Validated errors={this.props.errors} error_key="folder">
                                <input className="form-control" type="text"
                                       value={this.state.key} onChange={this.onKeyChange}>
                                </input>
                            </Validated>
                        </td>
                    </tr>
                </table>
            );
        }
    });

    function share_dialog(role, key) {
        var new_key, new_share;

        var default_share = {
            hosts: "*"
        };

        var dialog;
        var errors = null;

        new_key = key;
        new_share = key? role.parameters.shares[key] : default_share;

        function onchanged(key, share) {
            new_key = key;
            new_share = share;
            if (errors) {
                errors = null;
                update();
            }
        }

        function body_props() {
            return {
                title: _("Add New Share"),
                body: <ShareDialog key_={new_key} share={new_share}
                                   errors={errors}
                                   onchanged={onchanged}/>
            };
        }

        function update() {
            dialog.setProps(body_props());
        }

        function validate() {
            errors = { };

            function validate_folder_and_rest() {
                if (!new_key) {
                    errors.folder = _("Folder can't be empty");
                } else if (new_key[0] != "/") {
                    errors.folder = _("Folder must start with \"/\"");
                } else if (new_key != key && role.parameters.shares[new_key]) {
                    errors.folder = _("Folder is already shared");
                } else {
                    return cockpit.spawn([ "test", "-d", new_key ], { "superuser": "try" }).
                                   then(validate_rest, function () {
                                       errors.folder = _("Can't find a folder with that name");
                                       return validate_rest();
                                   });
                }
                return validate_rest();
            }

            function validate_rest() {
                if (Object.keys(errors).length === 0)
                    errors = null;
                update();
                return cockpit.resolve();
            }

            return validate_folder_and_rest();
        }

        function apply() {
            return validate().then(function () {
                if (errors) {
                    return cockpit.reject();
                } else {
                    var shares = $.extend({}, role.parameters.shares);
                    if (key)
                        delete shares[key];
                    shares[new_key] = new_share;
                    role.set({ shares: shares });
                    return cockpit.resolve();
                }
            });
        }

        dialog = dialog_view.show_modal_dialog(
            body_props(),
            {
                actions: [ { 'clicked': apply,
                             'caption': _("Apply"),
                             'style': 'primary' } ]
            }
        );
    }

    var RoleStatus = React.createClass({
        onReview: function (event) {
            show_failure_review_dialog(this.props.role);
        },
        render: function () {
            if (this.props.role.running) {
                return <center><div className="spinner"></div></center>;
            } else if (this.props.role.failed) {
                return (
                    <div className="alert alert-danger">
                        <span className="pficon pficon-error-circle-o"></span>
                        <button className="btn btn-default pull-right" onclick={this.onReview}>{_("Review")}</button>
                        <span className="alert-message">There was an error applying the configuration. The system might not behave as expected.</span>
                    </div>
                );
            } else {
                return null;
            }
        }
    });

    function show_failure_review_dialog(role) {
        function retry() {
            role.set(role.paramaters);
            return cockpit.resolve();
        }

        dialog_view.show_modal_dialog(
            {
                title: _("Error applying configuration"),
                body: <pre>{role.failed}</pre>
            },
            {
                cancel_caption: _("Close"),
                actions: [ { 'clicked': retry,
                             'caption': _("Retry"),
                             'style': 'primary' } ]
            }
        );
    }

    var role = ansible.role("nfs-server");

    function init() {
        role.wait().then(function () {
            function render() {
                React.render(
                    <div>
                        <RoleStatus role={role}/>
                        <SharesPanel role={role}/>
                    </div>,
                    $('#nfsserver')[0]);
            }
            $(role).on("changed", render);
            render();
            $('body').show();
        });
    }

    // This init_script is just for the PoC.  The real
    // thing is not expected to need any initialization.
    //
    cockpit.script(init_script, [ ], { "superuser": "require" }).then(init);
}());
