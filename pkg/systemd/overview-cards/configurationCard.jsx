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
import { Card, CardHeader, CardBody, Button } from '@patternfly/react-core';

import { OnOffSwitch } from "cockpit-components-onoff.jsx";
import * as service from "service.js";
import host_keys_script from "raw-loader!./ssh-list-host-keys.sh";
import cockpit from "cockpit";
import $ from "jquery";
import { mustache } from "mustache";
import * as packagekit from "packagekit.js";
import { install_dialog } from "cockpit-components-install-dialog.jsx";
import { Privileged, PrivilegedButton } from "cockpit-components-privileged.jsx";
import { ServerTime } from './serverTime.js';
import * as realmd from "./realmd-operation.js";

/* These add themselves to jQuery so just including is enough */
import "patterns";
import "bootstrap-datepicker/dist/js/bootstrap-datepicker";
import "patternfly-bootstrap-combobox/js/bootstrap-combobox";

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

        this.permission = cockpit.permission({ admin: true });
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

        dialog_setup(this.change_systime_dialog = new PageSystemInformationChangeSystime());
        this.systime_setup();

        $(this.pmlogger_service).on("changed", data => this.pmlogger_service_changed());
        this.pmlogger_service_changed();
        packagekit.detect().then(exists => {
            this.packagekit_exists = exists;
            this.update_pmlogger_row();
        });

        $("#system_information_ssh_keys").on("hide.bs.modal", () => this.host_keys_hide());

        this.realmd.addEventListener("changed", () => this.setState({}));
    }

    systime_setup() {
        const self = this;

        self.server_time = new ServerTime();
        $(self.server_time).on("changed", function() {
            self.setState({ serverTime: self.server_time.format(true) });
        });

        self.server_time.client.subscribe({
            interface: "org.freedesktop.DBus.Properties",
            member: "PropertiesChanged"
        }, self.server_time.ntp_updated);

        self.ntp_status_tmpl = $("#ntp-status-tmpl").html();
        mustache.parse(this.ntp_status_tmpl);

        self.ntp_status_icon_tmpl = $("#ntp-status-icon-tmpl").html();
        mustache.parse(this.ntp_status_icon_tmpl);

        var $ntp_status = $('#system_information_systime_ntp_status');

        function update_ntp_status() {
            // flag for tests that timedated proxy got activated
            if (self.server_time.timedate.CanNTP !== undefined && self.server_time.timedate1_service.unit && self.server_time.timedate1_service.unit.Id)
                $('#system_information_systime_button').attr("data-timedated-initialized", true);

            if (!self.server_time.timedate.NTP) {
                $ntp_status.hide();
                $ntp_status.attr("data-original-title", null);
                return;
            }

            $ntp_status.show();

            var model = {
                Synched: self.server_time.timedate.NTPSynchronized,
                service: null
            };

            var timesyncd_server_regex = /.*time server (.*)\./i;

            var timesyncd_status = (self.server_time.timesyncd_service.state == "running" &&
                                    self.server_time.timesyncd_service.service &&
                                    self.server_time.timesyncd_service.service.StatusText);

            if (self.server_time.timesyncd_service.state == "running")
                model.service = "systemd-timesyncd.service";

            if (timesyncd_status) {
                var match = timesyncd_status.match(timesyncd_server_regex);
                if (match)
                    model.Server = match[1];
                else if (timesyncd_status != "Idle." && timesyncd_status !== "")
                    model.SubStatus = timesyncd_status;
            }

            var tooltip_html = mustache.render(self.ntp_status_tmpl, model);
            if (tooltip_html != $ntp_status.attr("data-original-title"))
                $ntp_status.attr("data-original-title", tooltip_html);

            var icon_html = mustache.render(self.ntp_status_icon_tmpl, model);
            self.setState({ ntp_status_icon: { __html: icon_html } });
        }

        $ntp_status.tooltip();

        $(self.server_time.timesyncd_service).on("changed", update_ntp_status);
        $(self.server_time.timedate).on("changed", update_ntp_status);
        update_ntp_status();

        /* NTPSynchronized needs to be polled so we just do that
         * always.
         */
        window.setInterval(function() {
            self.server_time.poll_ntp_synchronized();
        }, 5000);
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
        // We use a Privileged component for its ability to
        // conditionally show a tooltip, even when the button is not
        // actually disabled, so the "allowed" property really means
        // "does not have tooltip" here.

        const hostname_tooltip = (!this.permission.allowed
            ? cockpit.format(_("The user $0 is not permitted to modify hostnames"),
                             this.permission.user ? this.permission.user.name : '')
            : this.realmd.hostname_button_tooltip);
        const hostname_disabled = !this.permission.allowed || this.realmd.hostname_button_disabled;

        const hostname_button = (
            <Privileged allowed={ !hostname_tooltip }
                        tooltipId="system_information_hostname_tooltip"
                        excuse={ hostname_tooltip }>
                <Button id="system_information_hostname_button" variant="link"
                        onClick={ () => $('#system_information_change_hostname').modal('show') }
                        isInline isDisabled={ hostname_disabled } aria-label="edit hostname">
                    {this.props.hostname !== "" ? _("edit") : _("Set Hostname")}
                </Button>
            </Privileged>);

        const systime_button = (
            <PrivilegedButton variant="link" buttonId="system_information_systime_button"
                              tooltipId="systime-tooltip"
                              onClick={ () => this.change_systime_dialog.display(this.server_time) }
                              excuse={ _("The user $0 is not permitted to change the system time") }
                              permission={ this.permission } ariaLabel="edit time">
                { this.state.serverTime }
            </PrivilegedButton>);

        const domain_tooltip = (!this.permission.allowed
            ? cockpit.format(_("The user $0 is not permitted to modify realms"),
                             this.permission.user ? this.permission.user.name : '')
            : this.realmd.button_tooltip);
        const domain_disabled = !this.permission.allowed || this.realmd.button_disabled;

        const domain_button = (
            <Privileged allowed={ !domain_tooltip }
                        tooltipId="system_information_domain_tooltip"
                        excuse={ domain_tooltip }>
                <Button id="system_information_domain_button" variant="link"
                        onClick={ () => this.realmd.clicked() }
                        isInline isDisabled={ domain_disabled } aria-label="join domain">
                    { this.realmd.button_text }
                </Button>
            </Privileged>);

        return (
            <Card className="system-configuration">
                <CardHeader>{_("Configuration")}</CardHeader>
                <CardBody>
                    <table className="pf-c-table pf-m-grid-md pf-m-compact">
                        <tbody>
                            <tr>
                                <th scope="row">{_("Hostname")}</th>
                                <td>
                                    {this.props.hostname && <span id="system_information_hostname_text">{this.props.hostname}</span>}
                                    {hostname_button}
                                </td>
                            </tr>

                            <tr>
                                <th scope="row">{_("System time")}</th>
                                <td>
                                    {systime_button}
                                    <a tabIndex="0" hidden id="system_information_systime_ntp_status"
                                        role="button" data-toggle="tooltip"
                                        data-placement="bottom" data-html="true" dangerouslySetInnerHTML={this.state.ntp_status_icon} />
                                </td>
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
                                    <button type="button" className="pf-c-button pf-m-link pf-m-inline" tabIndex="0" id="system-configuration-enable-pcp-link" onClick={() => install_dialog("cockpit-pcp")}>
                                        {_("Enable stored metrics")}
                                    </button>
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

PageSystemInformationChangeSystime.prototype = {
    _init: function() {
        this.id = "system_information_change_systime";
        this.date = "";
        this.ntp_type = null;
    },

    setup: function() {
        var self = this;

        function enable_apply_button() {
            $('#systime-apply-button').prop('disabled', false);
        }

        $("#systime-apply-button").on("click", $.proxy(this._on_apply_button, this));

        self.ntp_type = "manual_time";
        $('#change_systime ul').on('click', "li:not('.disabled')", function() {
            self.ntp_type = $(this).attr("value");
            self.update();
        });

        $('#systime-time-minutes').on('focusout', $.proxy(this, "update_minutes"));
        $('#systime-date-input').datepicker({
            autoclose: true,
            todayHighlight: true,
            format: 'yyyy-mm-dd'
        });
        $('#systime-timezones').css('max-height', '10em');
        $('#systime-timezones').combobox();
        $('label[for=systime-timezones] + div .input-group').addClass("combobox-with-reset");

        $('#systime-time-minutes').on('input', enable_apply_button);
        $('#systime-time-hours').on('input', enable_apply_button);
        $('#systime-date-input').on('input', enable_apply_button);
        $('#systime-timezones').on('change', enable_apply_button);
        $('#change_systime').on('click', enable_apply_button);
        $('#systime-date-input').on('focusin', $.proxy(this, "store_date"));
        $('#systime-date-input').on('focusout', $.proxy(this, "restore_date"));

        self.ntp_servers_tmpl = $("#ntp-servers-tmpl").html();
        mustache.parse(this.ntp_servers_tmpl);

        $('#systime-ntp-servers').on('click', '[data-action="add"]', function() {
            var index = $(this).attr('data-index');
            self.sync_ntp_servers();
            self.custom_ntp_servers.splice(index + 1, 0, "");
            self.update_ntp_servers();

            // HACK - without returning 'false' here, the dialog will
            // be magically closed when controlled by the
            // check-system-info test.
            return false;
        });

        $('#systime-ntp-servers').on('click', '[data-action="del"]', function() {
            var index = $(this).attr('data-index');
            self.sync_ntp_servers();
            self.custom_ntp_servers.splice(index, 1);
            self.update_ntp_servers();

            // HACK - without returning 'false' here, the dialog will
            // be magically closed when controlled by the
            // check-system-info test.
            return false;
        });
    },

    enter: function() {
        var self = this;

        $('#systime-date-input').val(self.server_time.format());
        $('#systime-time-minutes').val(self.server_time.utc_fake_now.getUTCMinutes());
        $('#systime-time-hours').val(self.server_time.utc_fake_now.getUTCHours());

        self.ntp_type = self.server_time.timedate.NTP ? (self.custom_ntp_enabled ? 'ntp_time_custom' : 'ntp_time') : 'manual_time';
        $('#change_systime [value="ntp_time"]')
                .toggleClass("disabled", !self.server_time.timedate.CanNTP);
        $('#change_systime [value="ntp_time_custom"]')
                .toggleClass("disabled", !(self.server_time.timedate.CanNTP && self.custom_ntp_supported));
        $('#systime-parse-error')
                .parent()
                .hide();
        $('#systime-timezone-error')
                .parent()
                .hide();
        $('#systime-apply-button').prop('disabled', false);
        $('#systime-timezones').prop('disabled', 'disabled');

        self.update();
        self.update_minutes();
        self.update_ntp_servers();
        self.get_timezones();
    },

    display: function(server_time) {
        var self = this;

        if (self.server_time) {
            console.warn("change-systime dialog reentered");
            return;
        }

        self.server_time = server_time;

        self.get_ntp_servers(function() {
            $('#system_information_change_systime').modal('show');
        });
    },

    get_timezones: function() {
        var self = this;

        function parse_timezones(content) {
            var lines = content.split('\n');
            var curr_timezone = self.server_time.timedate.Timezone;

            $('#systime-timezones').empty();

            for (var i = 0; i < lines.length; i++) {
                $('#systime-timezones').append($('<option>', {
                    value: lines[i],
                    text: lines[i].replace(/_/g, " "),
                    selected: lines[i] == curr_timezone
                }));
            }

            $('#systime-timezones').prop('disabled', false);
            $('#systime-timezones').combobox('refresh');
        }

        cockpit.spawn(["/usr/bin/timedatectl", "list-timezones"])
                .done(parse_timezones);
    },

    get_ntp_servers: function(callback) {
        var self = this;

        /* We only support editing the configuration of
         * systemd-timesyncd, by dropping a file into
         * /etc/systemd/timesyncd.conf.d.  We assume that timesyncd is
         * used when:
         *
         * - systemd-timedated is answering for
         *   org.freedesktop.timedate1 as opposed to, say, timedatex.
         *
         * - systemd-timesyncd is actually available.
         *
         * The better alternative would be to have an API in
         * o.fd.timedate1 for managing the list of NTP server
         * candidates.
         */

        var timedate1 = self.server_time.timedate1_service;
        var timesyncd = self.server_time.timesyncd_service;

        self.custom_ntp_supported = false;
        self.custom_ntp_enabled = false;
        self.custom_ntp_servers = [];

        function check() {
            if ((timedate1.exists === false || timedate1.unit) && (timesyncd.exists !== null)) {
                $([timedate1, timesyncd]).off(".get_ntp_servers");

                if (!timedate1.exists || timedate1.unit.Id !== "systemd-timedated.service") {
                    console.log("systemd-timedated not in use, ntp server configuration not supported");
                    callback();
                    return;
                }

                if (!timesyncd.exists) {
                    console.log("systemd-timesyncd not available, ntp server configuration not supported");
                    callback();
                    return;
                }

                self.custom_ntp_supported = true;

                if (!self.ntp_config_file)
                    self.ntp_config_file = cockpit.file("/etc/systemd/timesyncd.conf.d/50-cockpit.conf",
                                                        { superuser: "try" });

                self.ntp_config_file.read()
                        .done(function(text) {
                            var ntp_line = "";
                            self.ntp_servers = null;
                            if (text) {
                                self.custom_ntp_enabled = true;
                                text.split("\n").forEach(function(line) {
                                    if (line.indexOf("NTP=") === 0) {
                                        ntp_line = line.slice(4);
                                        self.custom_ntp_enabled = true;
                                    } else if (line.indexOf("#NTP=") === 0) {
                                        ntp_line = line.slice(5);
                                        self.custom_ntp_enabled = false;
                                    }
                                });

                                self.custom_ntp_servers = ntp_line.split(" ").filter(function(val) {
                                    return val !== "";
                                });
                                if (self.custom_ntp_servers.length === 0)
                                    self.custom_ntp_enabled = false;
                            }
                            callback();
                        })
                        .fail(function(error) {
                            console.warn("failed to load time servers", error);
                            callback();
                        });
            }
        }

        $([timedate1, timesyncd]).on("changed.get_ntp_servers", check);
        check();
    },

    set_ntp_servers: function(servers, enabled) {
        var self = this;

        var text = `# This file is automatically generated by Cockpit\n\n[Time]\n${enabled ? "" : "#"}NTP=${servers.join(" ")}\n`;

        return cockpit.spawn(["mkdir", "-p", "/etc/systemd/timesyncd.conf.d"], { superuser: "try" })
                .then(function() {
                    return self.ntp_config_file.replace(text);
                });
    },

    show: function() {
    },

    leave: function() {
        var self = this;

        $(self.server_time.timedate1_service).off(".change_systime");
        $(self.server_time.timesyncd_service).off(".change_systime");
        self.server_time = null;
    },

    _on_apply_button: function(event) {
        var self = this;

        if (!self.check_input())
            return;

        var manual_time = self.ntp_type == 'manual_time';
        var ntp_time_custom = self.ntp_type == 'ntp_time_custom';

        self.sync_ntp_servers();
        var servers = self.custom_ntp_servers.filter(function(val) { return val !== "" });

        function target_error (msg, target) {
            var err = new Error(msg);
            err.target = target;
            return err;
        }

        if (ntp_time_custom && servers.length === 0) {
            var err = target_error(_("Need at least one NTP server"),
                                   '#systime-ntp-servers .systime-inline');
            $("#system_information_change_systime").dialog("failure", err);
            return;
        }

        var promises = [];

        if (!$('#systime-timezones').prop('disabled')) {
            promises.push(
                self.server_time.timedate.call('SetTimezone', [$('#systime-timezones').val(), true]));
        }

        function set_ntp(val) {
            var promise = new Promise((resolve, reject) => {
                self.server_time.ntp_waiting_resolve = resolve;
            });
            self.server_time.ntp_waiting_value = val;
            self.server_time.client.call(self.server_time.timedate.path,
                                         "org.freedesktop.DBus.Properties", "Get", ["org.freedesktop.timedate1", "NTP"])
                    .done(function(result) {
                        // Check if don't want to enable enabled or disable disabled
                        if (result[0].v === val) {
                            self.server_time.ntp_waiting_resolve();
                            self.ntp_waiting_resolve = null;
                            return;
                        }
                        self.server_time.timedate.call('SetNTP', [val, true])
                                .catch(e => {
                                    self.server_time.ntp_waiting_resolve();
                                    self.ntp_waiting_resolve = null;
                                    console.error(e.message);
                                });
                    });
            return promise;
        }

        if (manual_time) {
            promises.push(
                set_ntp(false)
                        .then(function() {
                            return self.server_time.change_time($("#systime-date-input").val(),
                                                                $('#systime-time-hours').val(),
                                                                $('#systime-time-minutes').val());
                        }));
        } else if (!self.custom_ntp_supported) {
            promises.push(
                set_ntp(true));
        } else {
            /* HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1272085
             *
             * Switch off NTP, bump the clock by one microsecond to
             * clear the NTPSynchronized status, write the config
             * file, and switch NTP back on.
             *
             */
            promises.push(
                set_ntp(false)
                        .then(function() {
                            return self.server_time.timedate.call('SetTime', [1, true, true]);
                        })
                        .then(function() {
                            return self.set_ntp_servers(servers, ntp_time_custom);
                        })
                        .then(function() {
                            // NTPSynchronized should be false now.  Make
                            // sure we pick that up immediately.
                            self.server_time.poll_ntp_synchronized();

                            return set_ntp(true);
                        }));
        }

        // We can't use Promise.all() here, because dialg expects a promise
        // with a progress() method (see pkg/lib/patterns.js)
        // eslint-disable-next-line cockpit/no-cockpit-all
        $("#system_information_change_systime").dialog("promise", cockpit.all(promises));
    },

    check_input: function() {
        var date_error = false;
        var timezone_error = false;
        var new_date;

        var hours = $('#systime-time-hours').val();
        var minutes = $('#systime-time-minutes').val();
        var time_error = !/^[0-9]+$/.test(hours.trim()) || !/^[0-9]+$/.test(minutes.trim());

        if (!time_error) {
            hours = Number(hours);
            minutes = Number(minutes);
            time_error = hours < 0 || hours > 23 || minutes < 0 || minutes > 59;
        }

        new_date = new Date($("#systime-date-input").val());

        if (isNaN(new_date.getTime()) || new_date.getTime() < 0)
            date_error = true;

        if (time_error && date_error)
            $('#systime-parse-error').text(_("Invalid date format and invalid time format"));
        else if (time_error)
            $('#systime-parse-error').text(_("Invalid time format"));
        else if (date_error)
            $('#systime-parse-error').text(_("Invalid date format"));

        if ($('#systime-timezones').val() === "") {
            timezone_error = true;
            $('#systime-timezone-error').css('visibility', 'visible');
        } else {
            $('#systime-timezone-error').css('visibility', 'hidden');
        }

        $('#systime-timezone-error')
                .parent()
                .toggleClass("has-error", timezone_error);
        $('#systime-time-hours').toggleClass("has-error", time_error);
        $('#systime-time-minutes').toggleClass("has-error", time_error);
        $('#systime-date-input').toggleClass("has-error", date_error);

        $('#systime-parse-error')
                .parent()
                .toggleClass("has-error", time_error || date_error);
        $('#systime-parse-error')
                .parent()
                .toggle(time_error || date_error);
        $('#systime-timezone-error')
                .parent()
                .toggle(timezone_error);

        if (time_error || date_error || timezone_error) {
            $('#systime-apply-button').prop('disabled', true);
            return false;
        } else {
            $('#systime-apply-button').prop('disabled', false);
            return true;
        }
    },

    update: function() {
        var self = this;
        var manual_time = self.ntp_type === 'manual_time';
        var ntp_time_custom = self.ntp_type === 'ntp_time_custom';
        var text = $("#change_systime li[value=" + self.ntp_type + "]").text();
        $("#change_systime button span").text(text);
        $('#systime-manual-row, #systime-manual-error-row').toggle(manual_time);
        $('#systime-ntp-servers-row').toggle(ntp_time_custom);
        $('#systime-parse-error')
                .parent()
                .hide();
    },

    sync_ntp_servers: function() {
        var self = this;

        self.custom_ntp_servers = $('#systime-ntp-servers input')
                .map(function(i, elt) {
                    return $(elt).val();
                })
                .get();
    },

    update_ntp_servers: function() {
        var self = this;

        if (self.custom_ntp_servers === null || self.custom_ntp_servers.length === 0)
            self.custom_ntp_servers = [""];

        var model = {
            NTPServers: self.custom_ntp_servers.map(function(val, i) {
                return {
                    index: i,
                    Value: val,
                    Placeholder: _("NTP Server")
                };
            })
        };

        $('#systime-ntp-servers').html(mustache.render(self.ntp_servers_tmpl, model));
    },

    update_minutes: function() {
        var val = parseInt($('#systime-time-minutes').val(), 10);
        if (val < 10)
            $('#systime-time-minutes').val("0" + val);
    },

    store_date: function() {
        this.date = $("#systime-date-input").val();
    },

    restore_date: function() {
        if ($("#systime-date-input").val().length === 0)
            $("#systime-date-input").val(this.date);
    }
};

function PageSystemInformationChangeSystime() {
    this._init();
}
