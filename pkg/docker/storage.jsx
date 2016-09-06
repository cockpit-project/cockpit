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
    var cockpit_atomic_storage = require("raw!./cockpit-atomic-storage");

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    function init_model(callback) {
        var process;

        var self = {
            error: null,
            driver: "",
            pool_devices: [ ],
            extra_devices: [ ],
            total: 0,
            used: 0
        };

        function cmp_drive(a, b) {
            return a.sort_index - b.sort_index;
        }

        function update() {
            if (!cockpit.hidden && !process) {
                process = cockpit.spawn([ "python", "-c", cockpit_atomic_storage, "monitor" ],
                                        { err: "ignore",
                                          superuser: true }).
                                  stream(function (data) {
                                      // XXX - find the newlines here
                                      var info = JSON.parse(data);
                                      self.loopback = info.loopback;
                                      self.pool_devices = info.pool_devices.sort(cmp_drive);
                                      self.extra_devices = info.extra_devices.sort(cmp_drive);
                                      self.total = info.total;
                                      self.used = info.used;
                                      self.error = null;
                                      if (!info.can_manage)
                                          self.error = "unsupported";
                                      $(self).triggerHandler("changed");
                                  }).
                                  fail(function (error) {
                                      if (error != "closed") {
                                          console.warn(error);
                                          self.error = error.problem || "broken";
                                          $(self).triggerHandler("changed");
                                      }
                                  });
            } else if (cockpit.hidden && process) {
                process.close("closed");
                process = null;
            }
        }

        $(cockpit).on("visibilitychange", update);
        update();

        return self;
    }

    var storage_model = null;

    function get_storage_model() {
        if (!storage_model)
            storage_model = init_model();
        return storage_model;
    }

    /* A list of unused drives ready to be added to the Docker storage pool.
     *
     * model: The model as returned by get_storage_model.
     *
     * callback: Called as callback(drives, needs_reset) when
     *           the "Add" button is clicked.
     *
     */
    var DriveBox = React.createClass({
        getInitialState: function () {
            return {
                drives: this.props.model.extra_devices,
                checked: { }
            };
        },
        onModelChanged: function () {
            this.setState({ drives: this.props.model.extra_devices });
        },
        componentDidMount: function () {
            $(this.props.model).on("changed", this.onModelChanged);
            this.onModelChanged();
        },
        componentWillUnmount: function () {
            $(this.props.model).off("changed", this.onModelChanged);
        },

        driveChecked: function (drive) {
            return !!this.state.checked[drive.path];
        },
        toggleDrive: function (drive) {
            this.state.checked[drive.path] = !this.state.checked[drive.path];
            this.setState({ checked: this.state.checked });
        },

        onButtonClicked: function () {
            var self = this;
            if (self.props.callback) {
                var drives = [ ];
                for (var d in self.state.checked) {
                    if (self.state.checked[d]) {
                        for (var i = 0; i < self.state.drives.length; i++) {
                            if (self.state.drives[i].path == d) {
                                drives.push(self.state.drives[i]);
                            }
                        }
                    }
                }
                self.setState({ checked: { } });
                self.props.callback(drives, self.props.model.loopback);
            }
        },

        render: function() {
            var self = this;
            var i, d;

            var button_enabled = false;
            var drive_rows = [ ];
            var drive_paths = { };

            function drive_class_desc(cl) {
                switch (cl) {
                    case "sdd": return _("Solid-State Disk");
                    case "hdd": return _("Hard Disk");
                    default:    return _("Drive");
                }
            }

            for (i = 0; i < self.state.drives.length; i++) {
                var drive = self.state.drives[i];

                if (self.state.checked[drive.path])
                    button_enabled = true;

                drive_paths[drive.path] = true;

                drive_rows.push(
                    <tr onClick={self.toggleDrive.bind(self, drive)}>
                        <td><input type="checkbox"
                                   checked={self.driveChecked(drive)}/>
                        </td>
                        <td><img src="images/drive-harddisk-symbolic.svg"/></td>
                        <td>
                            <div>{drive.name}</div>
                            <div>{cockpit.format_bytes(drive.size)} {drive_class_desc(drive.class)}</div>
                        </td>
                    </tr>);
            }

            var drive_list;

            if (drive_rows.length > 0) {
                drive_list = (
                    <div>
                        <h4>{_("Local Disks")}</h4>
                        <table>
                            { drive_rows }
                        </table>
                    </div>);
            } else {
                drive_list = <span>{_("No additional local storage found.")}</span>;
            }

            return (
                <div className="drives-panel">
                    <div className="drives-panel-body">
                        { drive_list }
                    </div>
                    <div className="drives-panel-footer">
                        <button className="btn btn-primary"
                                disabled={ !button_enabled }
                                onClick={ self.onButtonClicked }>Add Storage</button>
                    </div>
                </div>
            );
        }
    });

    /* A list of drives in the Docker storage pool.
     *
     * model: The model as returned by get_storage_model.
     */
    var PoolBox = React.createClass({
        getInitialState: function () {
            return {
                drives: [ ]
            };
        },
        onModelChanged: function () {
            this.setState({ drives: this.props.model.pool_devices });
        },
        componentDidMount: function () {
            $(this.props.model).on("changed", this.onModelChanged);
            this.onModelChanged();
        },
        componentWillUnmount: function () {
            $(this.props.model).off("changed", this.onModelChanged);
        },

        render: function() {
            var self = this;

            function render_drive_rows() {
                return self.state.drives.map(function (drive) {
                    return (
                        <tr>
                            <td>{cockpit.format_bytes(drive.size)}</td>
                            <td><img src="images/drive-harddisk-symbolic.svg"/></td>
                            <td>{drive.name}{drive.shared? _(" (shared with the OS)"):""}</td>
                        </tr>);
                });
            }

            return (
                <table className="drive-list">
                    {render_drive_rows()}
                </table>);
        }
    });

    /* A overview of the Docker Storage pool size and how is used.
     *
     * model: The model as returned by get_storage_model.
     *
     * small: If true, a small version is rendered
     *        with a link to the setup page.
     */
    var OverviewBox = React.createClass({
        getInitialState: function () {
            return { total: 0, used: 0 };
        },
        onModelChanged: function () {
            this.setState({ error: this.props.model.error,
                            total: this.props.model.total,
                            used: this.props.model.used });
        },
        componentDidMount: function () {
            $(this.props.model).on("changed", this.onModelChanged);
            this.onModelChanged();
        },
        componentWillUnmount: function () {
            $(this.props.model).off("changed", this.onModelChanged);
        },

        render: function() {
            var self = this;

            if (!self.state.total) {
                return (<div>{_("Information about the Docker storage pool is not available.")}</div>);
            }

            var total_fmt = cockpit.format_bytes(self.state.total, undefined, true);
            var used_fmt = cockpit.format_bytes(self.state.used, total_fmt[1], true);
            var free_fmt = cockpit.format_bytes(self.state.total - self.state.used, undefined, true);

            var used_perc = (self.state.used / self.state.total) * 100 + "%";

            if (self.props.small) {
                return (
                    <div>
                        <div>
                            <div className="used-total">{used_fmt[0]} / {total_fmt[0]} {total_fmt[1]}</div>
                            <div>
                                <span className="free-text">{free_fmt[0]} </span>
                                <span className="free-unit">{free_fmt[1]} </span><span>{_("Free")}</span>
                            </div>
                        </div>
                        <div className="progress">
                            <div className="progress-bar" style={{width: used_perc}}>
                            </div>
                        </div>
                        {self.state.error? "" : <a translatable="yes" href="#/storage">configure storage...</a>}
                    </div>);
            } else {
                return (
                    <div>
                        <div>
                            <div className="used-total">
                                <table>
                                    <tr><td>{_("Used")}</td><td>{used_fmt[0]} {used_fmt[1]}</td></tr>
                                    <tr><td>{_("Total")}</td><td>{total_fmt[0]} {total_fmt[1]}</td></tr>
                                </table>
                            </div>
                            <div>
                                <span className="free-text">{free_fmt[0]}</span>
                                <div className="free-unit">
                                    {free_fmt[1]}<br/>{_("Free")}
                                </div>
                            </div>
                        </div>
                        <div className="progress">
                            <div className="progress-bar c2" style={{width: used_perc}}>
                            </div>
                        </div>
                    </div>);
            }
        }
    });

    function add_storage(client, drives, loopback) {
        function render_drive_rows() {
            return drives.map(function (drive) {
                return (
                    <tr>
                        <td>{cockpit.format_bytes(drive.size)}</td>
                        <td><img src="images/drive-harddisk-symbolic.svg"/></td>
                        <td>{drive.name}</td>
                    </tr>);
            });
        }

        var reset_warning = null;
        var storage_action = "add";
        var docker_will_be_stopped = false;
        var action_caption = _("Reformat and add disks");

        if (loopback) {
            reset_warning = (
                <div className="alert alert-danger">
                    <span className="fa fa-exclamation-triangle"></span>
                    <span className="alert-message">
                        {_("The storage pool will be reset to optimize its layout.  All containers will be erased.")}
                    </span>
                </div>);
            storage_action = "reset-and-add";
            docker_will_be_stopped = true;
            action_caption = _("Erase containers, reformat disks, and add them");
        }

        dialog_view.show_modal_dialog({ 'title': _("Add Additional Storage"),
                                        'body': (
                                            <div className="modal-body">
                                                <p>{_("All data on selected disks will be erased and disks will be added to the storage pool.")}</p>
                                                <table className="drive-list">
                                                    { render_drive_rows() }
                                                </table>
                                                { reset_warning }
                                            </div>),
                                      },
                                      { 'actions': [ { 'caption': action_caption,
                                                       'clicked': add_drives,
                                                       'style': "danger" } ]
                                      });

        function add_drives() {
            var dfd = $.Deferred();
            var devs = drives.map(function (d) { return d.path; });
            if (docker_will_be_stopped)
                client.close();
            var process = cockpit.spawn([ "python", "-c", cockpit_atomic_storage, storage_action ].concat(devs),
                                         { 'err': 'out',
                                           'superuser': true }).
                                  done(function (data) {
                                      if (docker_will_be_stopped) {
                                          client.connect().done(function () {
                                              dfd.resolve();
                                          });
                                      } else {
                                          dfd.resolve();
                                      }
                                  }).
                                  fail(function (error, data) {
                                      if (docker_will_be_stopped)
                                          client.connect();
                                      if (error.problem == "cancelled") {
                                          dfd.resolve();
                                          return;
                                      }
                                      dfd.reject(
                                          <div>
                                              <span>{_("Could not add all disks")}</span>
                                              <pre>{data}</pre>
                                          </div>);
                                  });
            var promise = dfd.promise();
            promise.cancel = function () {
                process.close("cancelled");
            };
            return promise;
        }
    }

    function reset_storage(client, service) {
        dialog_view.show_modal_dialog({ 'title': _("Reset Storage Pool"),
                                        'body': (
                                            <div className="modal-body">
                                                <p>{_("Resetting the storage pool will erase all containers and release disks in the pool.")}</p>
                                            </div>),
                                      },
                                      { 'actions': [ { 'caption': _("Erase containers and reset storage pool"),
                                                       'clicked': reset,
                                                       'style': "danger" } ]
                                      });
        function reset() {
            var dfd = $.Deferred();
            client.close();
            var process = cockpit.spawn([ "python", "-c", cockpit_atomic_storage, "reset-and-reduce" ],
                                        { 'err': 'out',
                                          'superuser': true }).
                                  done(function (data) {
                                      client.connect().done(function () {
                                          dfd.resolve();
                                      });
                                  }).
                                  fail(function (error, data) {
                                      client.connect();
                                      if (error.problem == "cancelled") {
                                          dfd.resolve();
                                          return;
                                      }
                                      dfd.reject(
                                          <div>
                                              <span>{_("Could not reset the storage pool")}</span>
                                              <pre>{data}</pre>
                                          </div>);
                                  });
            var promise = dfd.promise();
            promise.cancel = function () {
                process.close("cancelled");
            };
            return promise;
        }
    }

    function init_storage(client, service) {
        $('#storage .breadcrumb a').on("click", function() {
            cockpit.location.go('/');
        });

        $('#storage-reset').on('click', function () { reset_storage(client, service); });

        function add_callback(drives, driver) {
            add_storage(client, drives, driver);
        }

        var model = get_storage_model();

        React.render(<DriveBox model={model} callback={add_callback}/>,
                     $("#storage-drives")[0]);
        React.render(<PoolBox model={model}/>,
                     $("#storage-pool")[0]);
        React.render(<OverviewBox model={model}/>,
                     $("#storage-overview")[0]);

        function update_curtain() {
            if (model.error) {
                if (model.error == "access-denied")
                    $('#storage-unsupported-message').text(
                        _("You don't have permission to manage the Docker storage pool."));
                else
                    $('#storage-unsupported-message').text(
                        _("The Docker storage pool cannot be managed on this system."));
                $("#storage-unsupported").show();
                $("#storage-details").hide();
            } else {
                $("#storage-unsupported").hide();
                $("#storage-details").show();
            }
        }

        $(model).on("changed", update_curtain);
        update_curtain();

        function hide() {
            $('#storage').hide();
        }

        function show(id) {
            $('#storage').show();
        }

        return {
            show: show,
            hide: hide
        };
    }

    module.exports = {
        get_storage_model: get_storage_model,
        OverviewBox: OverviewBox,

        init: init_storage
    };
}());
