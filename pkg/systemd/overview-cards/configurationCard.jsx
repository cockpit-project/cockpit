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
import { Card, CardBody, Button, CardTitle } from '@patternfly/react-core';

import { OnOffSwitch } from "cockpit-components-onoff.jsx";
import * as service from "service.js";
import host_keys_script from "raw-loader!./ssh-list-host-keys.sh";
import cockpit from "cockpit";
import $ from "jquery";
import { mustache } from "mustache";
import * as packagekit from "packagekit.js";
import { install_dialog } from "cockpit-components-install-dialog.jsx";
import { Privileged } from "cockpit-components-privileged.jsx";
import { ServerTimeConfig } from './serverTime.js';
import * as realmd from "./realmd-operation.js";
import { superuser } from "superuser";

/* These add themselves to jQuery so just including is enough */
import "patterns";
import "bootstrap-datepicker/dist/js/bootstrap-datepicker";

import "./configurationCard.scss";

const _ = cockpit.gettext;

function dialog_setup(d) {
    d.setup();
    $('#' + d.id)
            .on('show.bs.modal', function(event) {
                if (event.target.id === d.id)
                    d.enter();
            })
            .on('shown.bs.modal', function(event) {
                if (event.target.id === d.id)
                    d.show();
            })
            .on('hidden.bs.modal', function(event) {
                if (event.target.id === d.id)
                    d.leave();
            });
}

export class ConfigurationCard extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            pmlogger_switch_visible: false,
            pcp_link_visible: false,
            serverTime: '',
        };

        this.pmcd_service = service.proxy("pmcd");
        this.pmlogger_service = service.proxy("pmlogger");
        this.pmlogger_exists = false;
        this.packagekit_exists = false;

        this.onPmLoggerSwitchChange = this.onPmLoggerSwitchChange.bind(this);
        this.update_pmlogger_row = this.update_pmlogger_row.bind(this);
        this.pmlogger_service_changed = this.pmlogger_service_changed.bind(this);

        this.host_keys_show = this.host_keys_show.bind(this);
        this.host_keys_hide = this.host_keys_hide.bind(this);

        this.realmd = realmd.setup();
    }

    componentDidMount() {
        dialog_setup(new PageSystemInformationChangeHostname());

        $(this.pmlogger_service).on("changed", data => this.pmlogger_service_changed());
        this.pmlogger_service_changed();
        packagekit.detect().then(exists => {
            this.packagekit_exists = exists;
            this.update_pmlogger_row();
        });

        $("#system_information_ssh_keys").on("hide.bs.modal", () => this.host_keys_hide());

        this.realmd.addEventListener("changed", () => this.setState({}));
    }

    host_keys_show() {
        var self = this;

        $("#system_information_ssh_keys .spinner").toggle(true);
        $("#system_information_ssh_keys .content").prop("hidden", true);
        $("#system_information_ssh_keys .pf-c-alert").toggle(false);

        /*
         * Yes, we do refresh the keys while the dialog is open.
         * It may occur that sshd is not running at the point when
         * we try, or in rare cases the keys may change.
         */
        self.host_keys_interval = window.setInterval(function() {
            self.host_keys_update();
        }, 10 * 1000);
        self.host_keys_update();
    }

    host_keys_hide() {
        window.clearInterval(this.host_keys_interval);
        this.host_keys_interval = null;
    }

    host_keys_update() {
        var self = this;
        var parenthesis = /^\((.*)\)$/;
        var spinner = $("#system_information_ssh_keys .spinner");
        var content = $("#system_information_ssh_keys .content");
        var error = $("#system_information_ssh_keys .pf-c-alert");

        cockpit.script(host_keys_script, [], {
            superuser: "try",
            err: "message"
        })
                .done(function(data) {
                    var seen = {};
                    var arr = [];
                    var keys = {};

                    var i, tmp, m;
                    var full = data.trim().split("\n");
                    for (i = 0; i < full.length; i++) {
                        var line = full[i];
                        if (!line)
                            continue;

                        var parts = line.trim().split(" ");
                        var title;
                        var fp = parts[1];
                        if (!seen[fp]) {
                            seen[fp] = fp;
                            title = parts[parts.length - 1];
                            if (title) {
                                m = title.match(parenthesis);
                                if (m && m[1])
                                    title = m[1];
                            }
                            if (!keys[title])
                                keys[title] = [];
                            keys[title].push(fp);
                        }
                    }

                    arr = Object.keys(keys);
                    arr.sort();
                    arr = arr.map(function(k) {
                        return { title: k, fps: keys[k] };
                    });

                    self.ssh_host_keys_tmpl = $("#ssh-host-keys-tmpl").html();
                    mustache.parse(self.ssh_host_keys_tmpl);

                    tmp = mustache.render(self.ssh_host_keys_tmpl, { keys: arr });
                    content.html(tmp);
                    spinner.toggle(false);
                    error.toggle(false);
                    content.prop("hidden", false);
                })
                .fail(function(ex) {
                    var msg = cockpit.format(_("failed to list ssh host keys: $0"), ex.message);
                    content.prop("hidden", true);
                    spinner.toggle(false);
                    $("#system_information_ssh_keys .pf-c-alert h4").text(msg);
                    error.toggle(true);
                });
    }

    onPmLoggerSwitchChange(enable) {
        if (!this.pmlogger_exists)
            return;

        this.update_pmlogger_row(true);

        if (enable) {
            this.pmlogger_promise = Promise.all([
                this.pmcd_service.enable(),
                this.pmcd_service.start(),
                this.pmlogger_service.enable(),
                this.pmlogger_service.start()
            ]).catch(function(error) {
                console.warn("Enabling pmlogger failed", error);
            });
        } else {
            this.pmlogger_promise = Promise.all([this.pmlogger_service.disable(), this.pmlogger_service.stop()])
                    .catch(function(error) {
                        console.warn("Disabling pmlogger failed", error);
                    });
        }
        this.pmlogger_promise.finally(() => {
            this.pmlogger_promise = null;
            this.pmlogger_service_changed();
        });
    }

    update_pmlogger_row(force_disable) {
        if (!this.pmlogger_exists) {
            this.setState({ pcp_link_visible: this.packagekit_exists });
            this.setState({ pmlogger_switch_visible: false });
        } else if (!this.pmlogger_promise) {
            this.setState({ pcp_link_visible: false });
            this.setState({ pmlogger_switch_visible: true });
        }
        this.setState({ pm_logger_switch_disabled: force_disable });
    }

    pmlogger_service_changed() {
        this.pmlogger_exists = this.pmlogger_service.exists;

        /* HACK: The pcp packages on Ubuntu and Debian include SysV init
         * scripts in /etc, which stay around when removing (as opposed to
         * purging) the package. Systemd treats those as valid units, even
         * if they're not backed by packages anymore. Thus,
         * pmlogger_service.exists will be true. Check for the binary
         * directly to make sure the package is actually available.
         */
        if (this.pmlogger_exists) {
            cockpit.spawn(["which", "pmlogger"], { err: "ignore" })
                    .fail(function() {
                        this.pmlogger_exists = false;
                    })
                    .always(() => this.update_pmlogger_row());
        } else {
            this.update_pmlogger_row();
        }
    }

    render() {
        let hostname_button = null;
        if (superuser.allowed && !this.realmd.hostname_button_disabled)
            hostname_button = (
                <Button id="system_information_hostname_button" variant="link"
                        onClick={ () => $('#system_information_change_hostname').modal('show') }
                        isInline aria-label="edit hostname">
                    {this.props.hostname !== "" ? _("edit") : _("Set Hostname")}
                </Button>);

        const domain_tooltip = superuser.allowed && this.realmd.button_tooltip;
        const domain_disabled = !superuser.allowed || this.realmd.button_disabled;

        const domain_button = (
            <Privileged allowed={ !domain_tooltip }
                        tooltipId="system_information_domain_tooltip"
                        excuse={ domain_tooltip }>
                <Button id="system_information_domain_button" variant="link"
                        onClick={ () => this.realmd.clicked() }
                        isInline isDisabled={ domain_disabled } aria-label="join domain">
                    { superuser.allowed ? this.realmd.button_text : _("Not joined") }
                </Button>
            </Privileged>);

        return (
            <Card className="system-configuration">
                <CardTitle>{_("Configuration")}</CardTitle>
                <CardBody>
                    <table className="pf-c-table pf-m-grid-md pf-m-compact">
                        <tbody>
                            <tr>
                                <th scope="row">{_("Hostname")}</th>
                                <td>
                                    {this.props.hostname && <span id="system_information_hostname_text">{this.props.hostname}</span>}
                                    <span>{hostname_button}</span>
                                </td>
                            </tr>

                            <tr>
                                <th scope="row">{_("System time")}</th>
                                <td><ServerTimeConfig /></td>
                            </tr>

                            <tr>
                                <th scope="row">{_("Domain")}</th>
                                <td>{domain_button}</td>
                            </tr>

                            <tr>
                                <th scope="row">{_("Performance profile")}</th>
                                <td><span id="system-info-performance" /></td>
                            </tr>

                            <tr>
                                <th scope="row">{_("Secure Shell keys")}</th>
                                <td>
                                    <Button variant="link" isInline id="system-ssh-keys-link" data-toggle="modal" onClick={this.host_keys_show}
                                        data-target="#system_information_ssh_keys">{_("Show fingerprints")}</Button>
                                </td>
                            </tr>

                            {this.state.pmlogger_switch_visible &&
                            <tr>
                                <th scope="row">{_("Store metrics")}</th>
                                <td>
                                    <OnOffSwitch
                                        id="server-pmlogger-switch"
                                        state={this.pmlogger_service.state === "running"}
                                        disabled={this.pmlogger_service.state == "starting" || this.state.pm_logger_switch_disabled}
                                        onChange={this.onPmLoggerSwitchChange} />
                                </td>
                            </tr>}

                            {this.state.pcp_link_visible &&
                            <tr>
                                <th scope="row">{_("PCP")}</th>
                                <td>
                                    <Button isInline variant="link" id="system-configuration-enable-pcp-link" onClick={() => install_dialog("cockpit-pcp")}>
                                        {_("Enable stored metrics")}
                                    </Button>
                                </td>
                            </tr>}

                        </tbody>
                    </table>
                </CardBody>
            </Card>
        );
    }
}

PageSystemInformationChangeHostname.prototype = {
    _init: function() {
        this.id = "system_information_change_hostname";
    },

    setup: function() {
        $("#sich-pretty-hostname").on("input change", $.proxy(this._on_full_name_changed, this));
        $("#sich-hostname").on("input change", $.proxy(this._on_name_changed, this));
        $("#sich-apply-button").on("click", $.proxy(this._on_apply_button, this));
    },

    enter: function() {
        this._always_update_from_pretty = false;
        this.client = cockpit.dbus('org.freedesktop.hostname1',
                                   { superuser : "try" });
        this.hostname_proxy = this.client.proxy();

        this.hostname_proxy.wait()
                .then(() => {
                    this._initial_hostname = this.hostname_proxy.StaticHostname || "";
                    this._initial_pretty_hostname = this.hostname_proxy.PrettyHostname || "";
                    $("#sich-pretty-hostname").val(this._initial_pretty_hostname);
                    $("#sich-hostname").val(this._initial_hostname);
                    this._update();
                });
    },

    show: function() {
        $("#sich-pretty-hostname").focus();
    },

    leave: function() {
        this.hostname_proxy = null;
    },

    _on_apply_button: function(event) {
        var new_full_name = $("#sich-pretty-hostname").val();
        var new_name = $("#sich-hostname").val();

        var one = this.hostname_proxy.call("SetStaticHostname", [new_name, true]);
        var two = this.hostname_proxy.call("SetPrettyHostname", [new_full_name, true]);

        // We can't use Promise.all() here, because dialg expects a promise
        // with a progress() method (see pkg/lib/patterns.js)
        // eslint-disable-next-line cockpit/no-cockpit-all
        $("#system_information_change_hostname").dialog("promise", cockpit.all([one, two]));
    },

    _on_full_name_changed: function(event) {
        /* Whenever the pretty host name has changed (e.g. the user has edited it), we compute a new
         * simple host name (e.g. 7bit ASCII, no special chars/spaces, lower case) from it...
         */
        var pretty_hostname = $("#sich-pretty-hostname").val();
        if (this._always_update_from_pretty || this._initial_pretty_hostname != pretty_hostname) {
            var old_hostname = $("#sich-hostname").val();
            var first_dot = old_hostname.indexOf(".");
            var new_hostname = pretty_hostname
                    .toLowerCase()
                    .replace(/['".]+/g, "")
                    .replace(/[^a-zA-Z0-9]+/g, "-");
            new_hostname = new_hostname.substr(0, 64);
            if (first_dot >= 0)
                new_hostname = new_hostname + old_hostname.substr(first_dot);
            $("#sich-hostname").val(new_hostname);
            this._always_update_from_pretty = true; // make sure we always update it from now-on
        }
        this._update();
    },

    _on_name_changed: function(event) {
        this._update();
    },

    _update: function() {
        var apply_button = $("#sich-apply-button");
        var note1 = $("#sich-note-1");
        var note2 = $("#sich-note-2");
        var changed = false;
        var valid = false;
        var can_apply = false;

        var charError = _("Real host name can only contain lower-case characters, digits, dashes, and periods (with populated subdomains)");
        var lengthError = _("Real host name must be 64 characters or less");

        var validLength = $("#sich-hostname").val().length <= 64;
        var hostname = $("#sich-hostname").val();
        var pretty_hostname = $("#sich-pretty-hostname").val();
        var validSubdomains = true;
        var periodCount = 0;

        for (var i = 0; i < $("#sich-hostname").val().length; i++) {
            if ($("#sich-hostname").val()[i] == '.')
                periodCount++;
            else
                periodCount = 0;

            if (periodCount > 1) {
                validSubdomains = false;
                break;
            }
        }

        var validName = (hostname.match(/[.a-z0-9-]*/) == hostname) && validSubdomains;

        if ((hostname != this._initial_hostname ||
            pretty_hostname != this._initial_pretty_hostname) &&
            (hostname !== "" || pretty_hostname !== ""))
            changed = true;

        if (validLength && validName)
            valid = true;

        if (changed && valid)
            can_apply = true;

        if (valid) {
            $(note1).css("visibility", "hidden");
            $(note2).css("visibility", "hidden");
            $("#sich-hostname-error").removeClass("has-error");
        } else if (!validLength && validName) {
            $("#sich-hostname-error").addClass("has-error");
            $(note1).text(lengthError);
            $(note1).css("visibility", "visible");
            $(note2).css("visibility", "hidden");
        } else if (validLength && !validName) {
            $("#sich-hostname-error").addClass("has-error");
            $(note1).text(charError);
            $(note1).css("visibility", "visible");
            $(note2).css("visibility", "hidden");
        } else {
            $("#sich-hostname-error").addClass("has-error");

            if ($(note1).text() === lengthError)
                $(note2).text(charError);
            else if ($(note1).text() === charError)
                $(note2).text(lengthError);
            else {
                $(note1).text(lengthError);
                $(note2).text(charError);
            }
            $(note1).css("visibility", "visible");
            $(note2).css("visibility", "visible");
        }

        apply_button.prop('disabled', !can_apply);
    }
};

function PageSystemInformationChangeHostname() {
    this._init();
}
