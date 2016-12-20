var $ = require("jquery");
$(function() {
    "use strict";

    var cockpit = require("cockpit");

    var mustache = require("mustache");
    var moment = require("moment");
    var journal = require("journal");

    /* These add themselves to jQuery so just including is enough */
    require("patterns");
    require("bootstrap-datepicker/dist/js/bootstrap-datepicker");

    cockpit.translate();
    var _ = cockpit.gettext;

    /* Notes about the systemd D-Bus API
     *
     * - One can use an object path for a unit that isn't currently
     *   loaded.  Doing so will load the unit (and emit UnitNew).
     *
     * - Calling o.fd.DBus.GetAll might thus trigger a UnitNew signal,
     *   so calling GetAll as a reaction to UnitNew might lead to
     *   infinite loops.
     *
     * - To avoid this cycle, we only call GetAll when there is some
     *   job activity for a unit, or when the whole daemon is
     *   reloaded.  The idea is that without jobs or a full reload,
     *   the state of a unit will not change in an interesting way.
     *
     * - We hope that the cache machinery in cockpit-bridge does not
     *   trigger such a cycle when watching a unit.
     *
     * - JobNew and JobRemoved signals don't include the object path
     *   of the affected units, but we can get those by listening to
     *   UnitNew.
     *
     * - There might be UnitNew signals for units that are never
     *   returned by ListUnits or ListUnitFiles.  These are units that
     *   are mentioned in Requires, After, etc or that people try to
     *   load via LoadUnit but that don't actually exist.
     *
     * - ListUnitFiles will return unit files that are aliases for
     *   other unit files, but ListUnits will not return aliases.
     *
     * - The "Names" property of a unit only includes those aliases
     *   that are currently loaded, not all.  To get all possible
     *   aliases, one needs to call ListUnitFiles and match units via
     *   their object path.
     *
     * - The unit file state of a alias as returned by ListUnitFiles
     *   is always the same as the unit file state of the primary unit
     *   file.
     *
     * - However, the unit file state as returned by ListUnitFiles is
     *   not necessarily the same as the UnitFileState property of a
     *   loaded unit.  ListUnitFiles reflects the state of the files
     *   on disk, while a loaded unit is only updated to that state
     *   via an explicit Reload.
     *
     * - Thus, we are careful to only use the UnitFileState as
     *   returned by ListUnitFiles or GetUnitFileState.  The
     *   alternative would be to only use the UnitFileState property,
     *   but we need one method call per unit to get them all for the
     *   overview, which seems excessive.
     *
     * - Methods like EnableUnitFiles only change the state of files
     *   on disk.  A Reload is necessary to update the state
     *   of loaded units.
     *
     * - A Reload will emit UnitRemoved/UnitNew signals for all units,
     *   and no PropertiesChanges signal for the properties that have
     *   changed because of the reload, such as UnitFileState.
     *
     */

    function startsWith(string, prefix) {
        return string.indexOf(prefix) === 0;
    }

    /* See systemd-escape(1), used for instantiating templates.
     */

    function systemd_escape(str) {

        function name_esc(str) {
            var validchars = /[0-9a-zA-Z:-_.\\]/;
            var res = "";
            var i;

            for (i = 0; i < str.length; i++) {
                var c = str[i];
                if (c == "/")
                    res += "-";
                else if (c == "-" || c == "\\" || !validchars.test(c)) {
                    res += "\\x";
                    var h = c.charCodeAt(0).toString(16);
                    while (h.length < 2)
                        h = "0" + h;
                    res += h;
                } else
                    res += c;
            }
            return res;
        }

        function kill_slashes(str) {
            str = str.replace(/\/+/g, "/");
            if (str.length > 1)
                str = str.replace(/\/$/, "").replace(/^\//, "");
            return str;
        }

        function path_esc(str) {
            str = kill_slashes(str);
            if (str == "/")
                return "-";
            else
                return name_esc(str);
        }

        if (str.length > 0 && str[0] == "/")
            return path_esc(str);
        else
            return name_esc(str);
    }

    var systemd_client = cockpit.dbus("org.freedesktop.systemd1", { superuser: "try" });
    var systemd_manager = systemd_client.proxy("org.freedesktop.systemd1.Manager",
                                               "/org/freedesktop/systemd1");

    /* OVERVIEW PAGE
     *
     * The overview page shows the current state of all units and unit
     * files.
     *
     * It mostly uses information returned by ListUnits and
     * ListUnitFiles in order to avoid flooding D-Bus with an
     * excessive amount of messages.  It listens for updates with the
     * usual PropertiesChanged signal.  However, as noted above, we
     * need to explicitly refresh the properties of a unit file in
     * case it got unloaded from the daemon.
     *
     * TODO - try what happens when we just use DBusProxies.
     */

    var units_initialized = false;
    var clock_realtime_now, clock_monotonic_now;

    function ensure_units() {
        if (!units_initialized) {
            units_initialized = true;
            init_units();
        }
    }

    function init_units() {
        var units_by_path = { };
        var path_by_id = { };

        function get_unit(path) {
            var unit = units_by_path[path];
            if (!unit) {
                unit = { aliases: [ ], path: path };
                units_by_path[path] = unit;
            }
            return unit;
        }

        function update_properties(unit, props) {
            function prop(p) {
                if (props[p])
                    unit[p] = props[p].v;
            }

            prop("Id");
            prop("Description");
            prop("LoadState");
            prop("ActiveState");
            prop("SubState");

            if (props["Id"])
                path_by_id[unit.Id] = unit.path;

            update_computed_properties(unit);
        }

        function update_computed_properties(unit) {
            var load_state = unit.LoadState;
            var active_state = unit.ActiveState;
            var sub_state = unit.SubState;

            if (load_state == "loaded")
                load_state = "";

            unit.HasFailed = (active_state == "failed" || load_state !== "");

            load_state = _(load_state);
            active_state = _(active_state);
            sub_state = _(sub_state);

            if (sub_state !== "" && sub_state != active_state)
                active_state = active_state + " (" + sub_state + ")";

            if (load_state !== "")
                active_state = load_state + " / " + active_state;

            unit.CombinedState = active_state;

            if (unit.Id.slice(-5) == "timer") {
                unit.is_timer = true;
                if (unit.ActiveState == "active") {
                    var timer_unit = systemd_client.proxy('org.freedesktop.systemd1.Timer', unit.path);
                    timer_unit.wait(function() {
                        if (timer_unit.valid)
                            add_timer_properties(timer_unit, unit);
                    });
                }
            }
        }

        function refresh_properties(path, tweak_callback) {
            systemd_client.call(path,
                                "org.freedesktop.DBus.Properties", "GetAll",
                                [ "org.freedesktop.systemd1.Unit" ]).
                fail(function (error) {
                    console.log(error);
                }).
                done(function (result) {
                    var unit = get_unit(path);
                    update_properties(unit, result[0]);
                    if (tweak_callback)
                        tweak_callback(unit);
                    render();
                });
        }

        function add_timer_properties(timer_unit,unit) {
            unit.LastTriggerTime = moment(timer_unit.LastTriggerUSec/1000).calendar();
            var system_boot_time = clock_realtime_now.valueOf()*1000 - clock_monotonic_now;
            if (timer_unit.LastTriggerUSec === -1 || timer_unit.LastTriggerUSec === 0)
                unit.LastTriggerTime = _("unknown");
            var next_run_time = 0;
            if (timer_unit.NextElapseUSecRealtime === 0)
                next_run_time = timer_unit.NextElapseUSecMonotonic + system_boot_time;
            else if (timer_unit.NextElapseUSecMonotonic === 0)
                next_run_time = timer_unit.NextElapseUSecRealtime;
            else {
                if (timer_unit.NextElapseUSecMonotonic + system_boot_time < timer_unit.NextElapseUSecRealtime)
                    next_run_time = timer_unit.NextElapseUSecMonotonic + system_boot_time;
                else
                    next_run_time = timer_unit.NextElapseUSecRealtime;
            }
            unit.NextRunTime = moment(next_run_time/1000).calendar();
            if (timer_unit.NextElapseUSecMonotonic <= 0 && timer_unit.NextElapseUSecRealtime <= 0)
                unit.NextRunTime = _("unknown");
        }

        var units_template = $("#services-units-tmpl").html();
        mustache.parse(units_template);

        function render_now() {
            var pattern = $('#services-filter button.active').attr('data-pattern');

            function cmp_path(a, b) { return units_by_path[a].Id.localeCompare(units_by_path[b].Id); }
            var sorted_keys = Object.keys(units_by_path).sort(cmp_path);
            var enabled = [ ], disabled = [ ], statics = [ ];
            var header = {
                Description: _("Description"),
                Id: _("Id"),
                is_timer: (~pattern.indexOf("timer")),
                Next_Run_Time: _("Next Run"),
                Last_Trigger_Time: _("Last Trigger"),
                Current_State: _("State")
            };
            if (header.is_timer)
                $('#create-timer').show();
            else
                $('#create-timer').hide();
            sorted_keys.forEach(function (path) {
                var unit = units_by_path[path];
                if (!(unit.Id && pattern && unit.Id.match(pattern)))
                    return;
                if (unit.UnitFileState && startsWith(unit.UnitFileState, 'enabled'))
                    enabled.push(unit);
                else if (unit.UnitFileState && startsWith(unit.UnitFileState, 'disabled'))
                    disabled.push(unit);
                else
                    statics.push(unit);
            });

            function fill_table(parent, heading, units) {
                var text = mustache.render(units_template, {
                    heading: heading,
                    table_head: header,
                    units: units
                });
                parent.html(text);
            }

            fill_table($('#services-list-enabled'), _("Enabled"), enabled);
            fill_table($('#services-list-disabled'), _("Disabled"), disabled);
            fill_table($('#services-list-static'), _("Static"), statics);
        }

        var render_holdoff_timer;
        var need_render;

        function render() {
            if (!render_holdoff_timer) {
                render_now();
                render_holdoff_timer = window.setTimeout(render_holdoff_over, 200);
            } else {
                need_render = true;
            }
        }

        function render_holdoff_over() {
            render_holdoff_timer = null;
            if (need_render) {
                need_render = false;
                render_now();
            }
        }

        var update_run = 0;

        function update_all() {
            var my_run = ++update_run;

            var seen_ids = { };

            function fail(error) {
                console.log(error);
            }

            function record_unit_state(state) {
                // 0: Id
                // 1: Description
                // 2: LoadState
                // 3: ActiveState
                // 4: SubState
                // 5: Following
                // 6: object-path
                // 7: Job[0], number
                // 8: job-type
                // 9: Job[1], object-path

                seen_ids[state[0]] = true;

                var unit = get_unit(state[6]);
                unit.Id = state[0];
                unit.Description = state[1];
                unit.LoadState = state[2];
                unit.ActiveState = state[3];
                unit.SubState = state[4];

                path_by_id[unit.Id] = unit.path;

                update_computed_properties(unit);
            }

            function record_unit_file_state(state) {
                // 0: FragmentPath
                // 1: UnitFileState

                var name = state[0].split('/').pop();

                seen_ids[name] = true;

                if (name.indexOf("@") != -1) {
                    // A template, create a fake unit for it
                    units_by_path[name] = {
                        Id: name,
                        Description: cockpit.format(_("$0 Template"), name),
                        UnitFileState: state[1],
                        is_timer: (name.slice(-5) == "timer")
                    };
                    path_by_id[name] = name;
                    return;
                }

                /* We need to know the object path for detecting
                 * aliases and we also need at least the Description
                 * property, so we load all unloaded units here with a
                 * LoadUnit/GetAll pair of method calls.
                 */

                if (path_by_id[name])
                    with_path(path_by_id[name]);
                else {
                    systemd_manager.LoadUnit(name).
                        fail(function (error) {
                            console.log(error);
                        }).
                        done(with_path);
                }

                function with_path(path) {
                    var unit = units_by_path[path];

                    if (unit)
                        with_unit(unit);
                    else
                        refresh_properties(path, with_unit);

                    function with_unit(unit) {
                        if (unit.Id == name) {
                            // Primary id, add UnitFileState
                            unit.UnitFileState = state[1];
                        } else {
                            // Alias for loaded unit, add alias
                            unit.aliases.push(name);
                        }
                        update_computed_properties(unit);
                    }
                }
            }

            systemd_manager.ListUnits().
                fail(fail).
                done(function (result) {
                    if (my_run != update_run)
                        return;
                    for (var i = 0; i < result.length; i++)
                        record_unit_state(result[i]);
                    systemd_manager.ListUnitFiles().
                        fail(fail).
                        done(function (result) {
                            var i, keys;
                            if (my_run != update_run)
                                return;
                            for (i = 0; i < result.length; i++)
                                record_unit_file_state(result[i]);
                            keys = Object.keys(units_by_path);
                            for (i = 0; i < keys; i++) {
                                if (!seen_ids[units_by_path[keys[i]].Id]) {
                                    console.log("R", keys[i]);
                                    delete units_by_path[keys[i]];
                                }
                            }
                            render();
                        });
                });
        }

        $(systemd_manager).on("UnitNew", function (event, id, path) {
            path_by_id[id] = path;
        });

        $(systemd_manager).on("JobNew JobRemoved", function (event, number, path, unit_id, result) {
            var unit_path = path_by_id[unit_id];
            if (unit_path)
                refresh_properties(unit_path);
        });

        systemd_client.subscribe({ 'interface': "org.freedesktop.DBus.Properties",
                                   'member': "PropertiesChanged"
                                 },
                                 function (path, iface, signal, args) {
                                     var unit = units_by_path[path];
                                     if (unit) {
                                         update_properties(unit, args[1]);
                                         render();
                                     }
                                 });

        $(systemd_manager).on("UnitFilesChanged", function (event) {
            update_all();
        });

        $('#services-filter button').on('click', function () {
            $('#services-filter button').removeClass('active');
            $(this).addClass('active');
            render();
        });

        update_all();
    }

    /* UNIT PAGE
     *
     * The unit page mostly uses a regular DBusProxy (cur_unit) that
     * drives a Mustache template.  The UnitFileState property is not
     * used via the proxy but is updated separately via GetUnitFile
     * state so that it is consistent with the value shown on the
     * overview page.
     *
     * Templates are not exposed on D-Bus, but they also have no
     * interesting properties (unfortunately), so they are handled as
     * a very simple special case (cur_unit_is_template is true).
     *
     */

    var cur_unit_id;
    var cur_unit;
    var cur_unit_file_state;
    var cur_unit_is_template;
    var cur_unit_template;
    var cur_journal_watcher;

    var action_btn_template = $("#action-btn-tmpl").html();
    mustache.parse(action_btn_template);

    var unit_template = $("#service-unit-tmpl").html();
    mustache.parse(unit_template);

    var template_template = $("#service-template-tmpl").html();
    mustache.parse(template_template);

    var unit_actions = [                          // <method>:<mode>
        { title: _("Start"),                 action: 'StartUnit' },
        { title: _("Stop"),                  action: 'StopUnit' },
        { title: _("Restart"),               action: 'RestartUnit' },
        { title: _("Reload"),                action: 'ReloadUnit' },
        { title: _("Reload or Restart"),     action: 'ReloadOrRestartUnit' },
        { title: _("Try Restart"),           action: 'TryRestartUnit' },
        { title: _("Reload or Try Restart"), action: 'ReloadOrTryRestartUnit' },
        { title: _("Isolate"),               action: 'StartUnit:isolate' }
    ];

    function unit_action() {
        /* jshint validthis:true */
        var parsed_action = $(this).attr("data-action").split(":");
        var method = parsed_action[0];
        var mode = parsed_action[1];

        if (cur_unit) {
            systemd_manager.call(method, [ cur_unit_id, mode || "fail"]).
                fail(function (error) {
                    $('#service-error-dialog-message').text(error.toString());
                    $('#service-error-dialog').modal('show');
                });
        }
    }

    var file_actions = [                          // <method>:<force>
        { title: _("Enable"),                action: 'EnableUnitFiles:false' },
        { title: _("Enable Forcefully"),     action: 'EnableUnitFiles:true' },
        { title: _("Disable"),               action: 'DisableUnitFiles' },
        { title: _("Preset"),                action: 'PresetUnitFiles:false' },
        { title: _("Preset Forcefully"),     action: 'PresetUnitFiles:true' },
        { title: _("Mask"),                  action: 'MaskUnitFiles:false' },
        { title: _("Mask Forcefully"),       action: 'MaskUnitFiles:true' },
        { title: _("Unmask"),                action: 'UnmaskUnitFiles' }
    ];

    function unit_file_action() {
        /* jshint validthis:true */
        var parsed_action = $(this).attr("data-action").split(":");
        var method = parsed_action[0];
        var force = parsed_action[1];

        if (cur_unit) {
            var args = [ [ cur_unit_id ], false ];
            if (force !== undefined)
                args.push(force == "true");
            systemd_manager.call(method, args).
                done(function () {
                    if (arguments.length == 2 && !arguments[0])
                        $('#service-no-install-info-dialog').modal('show');
                    systemd_manager.Reload();
                }).
                fail(function(error) {
                    $('#service-error-dialog-message').text(error.toString());
                    $('#service-error-dialog').modal('show');
                });
        }
    }

    function show_unit(unit_id) {
        if (cur_unit) {
            $(cur_unit).off('changed');
            cur_unit = null;
            cur_unit_file_state = null;
        }
        if (cur_journal_watcher) {
            cur_journal_watcher.stop();
            cur_journal_watcher = null;
        }

        function render() {
            if (!cur_unit.valid)
                return;

            var unit_def;
            var active_state = cur_unit.ActiveState;
            if (active_state == 'active' || active_state == 'reloading' ||
                active_state == 'activating')
                unit_def = 1; // Stop
            else
                unit_def = 0; // Start

            var file_def;
            var load_state = cur_unit.LoadState;
            var file_state = cur_unit.UnitFileState;
            if (load_state == 'masked')
                file_def = 7; // Unmask
            else if (file_state == 'static')
                file_def = 5; // Mask
            else if (file_state == 'enabled')
                file_def = 2; // Disable
            else
                file_def = 0; // Enable

            var timestamp;
            if (active_state == 'active' || active_state == 'reloading')
                timestamp = cur_unit.ActiveEnterTimestamp;
            else if (active_state == 'inactive' ||active_state == 'failed')
                timestamp = cur_unit.InactiveEnterTimestamp;
            else if (active_state == 'activating')
                timestamp = cur_unit.InactiveExitTimestamp;
            else
                timestamp = cur_unit.ActiveExitTimestamp;

            var since = "";
            if (timestamp)
                since = cockpit.format(_("Since $0"), new Date(timestamp/1000).toLocaleString());

            var unit_action_btn = mustache.render(action_btn_template,
                                                  {
                                                      id: "service-unit-action",
                                                      def: unit_actions[unit_def],
                                                      actions: unit_actions
                                                  });
            var file_action_btn = mustache.render(action_btn_template,
                                                  {
                                                      id: "service-file-action",
                                                      def: file_actions[file_def],
                                                      actions: file_actions
                                                  });
            var template_description = null;
            if (cur_unit_template) {
                var link = mustache.render('<a data-goto-unit="{{unit}}">{{unit}}</a>',
                                           { unit: cur_unit_template });
                template_description = cockpit.format(_("This unit is an instance of the $0 template."), link);
            }

            var text = mustache.render(unit_template,
                                       {
                                           Unit: cur_unit,
                                           Since: since,
                                           HasLoadError: cur_unit.LoadState !== "loaded",
                                           LoadError: cur_unit.LoadError ? cur_unit.LoadError[1] : null,
                                           UnitFileState: cur_unit_file_state,
                                           TemplateDescription: template_description,
                                           UnitButton: unit_action_btn,
                                           FileButton: file_action_btn,
                                       });
            $('#service-unit').html(text);
            $('#service-unit-action').on('click', "[data-action]", unit_action);
            $('#service-file-action').on('click', "[data-action]", unit_file_action);
        }

        function render_template() {
            var text = mustache.render(template_template,
                                       {
                                           Description: cockpit.format(_("$0 Template"), cur_unit_id)
                                       });
            $('#service-template').html(text);
        }

        $("#service-valid").hide();
        $("#service-template").hide();
        $("#service-invalid").hide();
        $("#service").hide();

        cur_unit_id = unit_id;

        if (!cur_unit_id)
            return;

        $('#service .breadcrumb .active').text(unit_id);

        var tp = cur_unit_id.indexOf("@");
        var sp = cur_unit_id.lastIndexOf(".");
        cur_unit_is_template = (tp != -1 && (tp + 1 == sp || tp + 1 == cur_unit_id.length));
        cur_unit_template = undefined;
        if (tp != -1 && !cur_unit_is_template) {
            cur_unit_template = cur_unit_id.substring(0, tp + 1);
            if (sp != -1)
                cur_unit_template = cur_unit_template + cur_unit_id.substring(sp);
        }

        if (cur_unit_is_template) {
            render_template();
            $("#service-template").show();
            $("#service").show();
            return;
        }

        systemd_manager.LoadUnit(unit_id).
            done(function (path) {
                if (cur_unit_id == unit_id) {
                    var unit = systemd_client.proxy('org.freedesktop.systemd1.Unit', path);
                    cur_unit = unit;
                    unit.wait(function() {
                        if (cur_unit == unit) {
                            render();
                            $(cur_unit).on('changed', render);
                            $("#service-valid").show();
                            $("#service").show();
                        }
                    });
                }
            }).
            fail(function (error) {
                $("#service-error-message").text(error.toString());
                $("#service-invalid").show();
                $("#service").show();
            });

        refresh_unit_file_state();

        cur_journal_watcher = journal.logbox([ "_SYSTEMD_UNIT=" + cur_unit_id, "+",
                                              "COREDUMP_UNIT=" + cur_unit_id, "+",
                                              "UNIT=" + cur_unit_id ], 10);
        $('#service-log').empty().append(cur_journal_watcher);
    }

    function unit_goto() {
        /* jshint validthis:true */
        cockpit.location.go([ $(this).attr("data-goto-unit") ]);
    }

    function unit_instantiate(param) {
        if (cur_unit_id) {
            var tp = cur_unit_id.indexOf("@");
            var sp = cur_unit_id.lastIndexOf(".");
            if (tp != -1) {
                var s = cur_unit_id.substring(0, tp+1);
                s = s + systemd_escape(param);
                if (sp != -1)
                    s = s + cur_unit_id.substring(sp);
                cockpit.location.go([ s ]);
            }
        }
    }

    function refresh_unit() {
        var unit = cur_unit;
        if (unit) {
            systemd_client.call(unit.path,
                                "org.freedesktop.DBus.Properties", "GetAll",
                                [ "org.freedesktop.systemd1.Unit" ]).
                fail(function (error) {
                    console.log(error);
                }).
                done(function (result) {
                    var props = { };
                    for (var p in result[0])
                        props[p] = result[0][p].v;
                    var ifaces = { };
                    ifaces["org.freedesktop.systemd1.Unit"] = props;
                    var data = { };
                    data[unit.path] = ifaces;
                    systemd_client.notify(data);
                });
        }
    }

    function refresh_unit_file_state() {
        var unit_id = cur_unit_id;
        if (unit_id) {
            systemd_manager.GetUnitFileState(unit_id).
                done(function (state) {
                    if (cur_unit_id == unit_id) {
                        cur_unit_file_state = state;
                        if (cur_unit)
                            $(cur_unit).triggerHandler("changed");
                    }
                });
        }
    }

    $(systemd_manager).on("Reloading", function (event, reloading) {
        if (!reloading)
            refresh_unit();
    });

    $(systemd_manager).on("JobNew JobRemoved", function (event, number, path, unit_id, result) {
        if (cur_unit_id == unit_id)
            refresh_unit();
    });

    $(systemd_manager).on("UnitFilesChanged", function (event) {
        refresh_unit_file_state();
    });

    /* NAVIGATION
     */

    function update() {
        var path = cockpit.location.path;

        if (path.length === 0) {
            show_unit(null);
            ensure_units();
            $("#services").show();
        } else if (path.length == 1) {
            $("#services").hide();
            show_unit(cockpit.location.path[0]);
        } else { /* redirect */
            console.warn("not a init location: " + path);
            cockpit.location = '';
        }
        $("body").show();
    }

    $(cockpit).on("locationchanged", update);

    $('#service-navigate-home').on("click", function() {
        cockpit.location.go('/');
    });

    $('body').on('click', "[data-goto-unit]", unit_goto);

    $('#service-template').on('click', 'button', function () {
        unit_instantiate($('#service-template input').val());
    });

    /* Timer Creation
     * timer_unit contains all the user's valid inputs from create-timer modal.
     */
    var permission = cockpit.permission({ admin: true });
    $(permission).on("changed", function() {
        if (permission.allowed === false) {
            $("#create-timer").addClass("accounts-privileged");
            $(".accounts-privileged").update_privileged(
                permission, cockpit.format(
                    _("The user <b>$0</b> does not have permissions for creating timers"),
                    permission.user ? permission.user.name : ''),
                "left"
            );
        }
    });

    $("#create-timer").on("click", function() {
        timer_init();
        $("#timer-dialog").modal("show");
        update_time();
    });

    $("#timer-dialog").on("click", "#timer-save-button", function() {
        var close_modal = create_timer();
        if (close_modal)
            $("#timer-dialog").modal("toggle");
    });

    function update_time() {
        cockpit.spawn(["grep", "\\w", "timer_list"],
                      { directory: "/proc" }).
            fail(function (err) {
                console.log(err);
            }).
            done(function (timer_list) {
                clock_monotonic_now = parseInt(timer_list.match(/now at (\d+)/)[1]/1000, 10);
            });
        cockpit.spawn(["date", "-R"]).
            fail(function (err) {
                console.log(err);
            }).
            done(function (time) {
                clock_realtime_now = moment(time, "ddd, DD MMM YYYY HH:mm:ss ZZ"); // rfc822 date
            });
    }
    update_time();
    var timedate_client = cockpit.dbus('org.freedesktop.timedate1');
    timedate_client.subscribe({ 'interface': "org.freedesktop.DBus.Properties",
                                   'member': "PropertiesChanged"
                                 }, update_time);
    var timer_unit = { };
    var repeat_array = [ ];
    var error = false;
    var repeat_hourly_template = $("#repeat-hourly-tmpl").html();
    mustache.parse(repeat_hourly_template);
    var repeat_daily_template = $("#repeat-daily-tmpl").html();
    mustache.parse(repeat_daily_template);
    var repeat_weekly_template = $("#repeat-weekly-tmpl").html();
    mustache.parse(repeat_weekly_template);
    var repeat_monthly_template = $("#repeat-monthly-tmpl").html();
    mustache.parse(repeat_monthly_template);
    var repeat_yearly_template = $("#repeat-yearly-tmpl").html();
    mustache.parse(repeat_yearly_template);
    /* Available Options for timer creation
     * Don't Repeat   : 0
     * Repeat Hourly  : 60     (60min)
     * Repeat Daily   : 1440   (60*24min)
     * Repeat Weekly  : 10080  (60*24*7min)
     * Repeat Monthly : 44640  (60*24*31min)
     * Repeat Yearly  : 525600 (60*24*365min)
     */
    var repeat_option = [
        { index: 0,      render: "" },
        { index: 60,     render: repeat_hourly_template },
        { index: 1440,   render: repeat_daily_template },
        { index: 10080,  render: repeat_weekly_template },
        { index: 44640,  render: repeat_monthly_template },
        { index: 525600, render: repeat_yearly_template }
    ];
    // Removes error notification when user starts typing in the error-field.
    $("#timer-dialog").on("keypress", ".form-control", function() {
        $(this).removeClass("has-error");
        if ($(this).attr("id") == "hr")
            $("#hr-error").text("");
        else if ($(this).attr("id") == "min")
            $("#min-error").text("");
        else if ($(this).attr("data-content") == "hours")
            $(this).siblings("[data-content='hr-error']").text("");
        else if ($(this).attr("data-content") == "minutes")
            $(this).siblings("[data-content='min-error']").text("");
        else
            $(this).parents("tr").next().hide();
    });
    /* HACK - bootstrap datepicker positions itself incorrectly on modals
     * that has scroll bar. This hack finds how much user has scrolled
     * and places the datepicker element accordingly.
     * scroll_top: the amount user scrolled when datepicker is absent
     * scroll_top_datepicker: the amount user scrolled when datepicker is present.
     */
    var scroll_top = 0;
    var scroll_top_datepicker = 0;
    // Datepicker is hidden initially and gets positioned correctly when clicked.
    $("#timer-dialog").on('click', "[data-content='datepicker']", function() {
        scroll_top = $("#timer-dialog").scrollTop();
        $(this).removeClass("has-error");
        $("[data-index='" + $(this).attr('data-index') + "'][data-content='date-error']").text("");
        $(".datepicker-dropdown").css("margin-top", $("#timer-dialog").scrollTop());
        $(".datepicker-dropdown").css("visibility", "visible");
        $(".datepicker-dropdown .next").show();
        $(".datepicker-dropdown .prev").show();
    });
    // This avoids datepicker incorrect positioning when a click occurs inside it.
    $("#timer-dialog").on('click', ".datepicker.datepicker-dropdown.dropdown-menu", function() {
        if (scroll_top_datepicker > scroll_top)
            $(".datepicker.datepicker-dropdown.dropdown-menu").css("margin-top", scroll_top_datepicker);
        else
            $(".datepicker.datepicker-dropdown.dropdown-menu").css("margin-top", scroll_top);
    });
    // Calculates the new position when mouse enters the header of datepicker.
    $("#timer-dialog").on('mouseenter', ".datepicker.datepicker-dropdown [class*='datepicker-'] thead", function() {
        scroll_top_datepicker = $("#timer-dialog").scrollTop();
    });

    $(".form-table-ct").on("click", "[value]", ".btn-group.bootstrap-select.dropdown.form-control", function(ev) {
        var target = $(this).closest(".btn-group.bootstrap-select.dropdown.form-control");
        $("span", target).first().text(ev.target.text);
        $("span", target).first().attr("value", ev.currentTarget.value);
        switch(target.attr('id')) {
            case "boot-or-specific-time" : set_boot_or_calendar(Number(ev.currentTarget.value));
            break;
            case "drop-time" : set_boot_time_unit(Number(ev.currentTarget.value));
            break;
            case "drop-repeat" : repeat_options(Number(ev.currentTarget.value));
            break;
        }
    });
    // Initialises create timer modal to default options.
    function timer_init() {
        $("#command").val("");
        $("#description").val("");
        $("#servicename").val("");
        set_boot_or_calendar(1);
        $("span", $("#boot-or-specific-time")).first().text("After system boot");
        $("span", $("#drop-time")).first().text("Seconds");
        $("span", $("#drop-time")).first().attr("value", "1");
        $(".form-control").removeClass("has-error");
        $(".has-error").hide();
        repeat_array = [ ];
        timer_unit = {
            Calendar_or_Boot: "Boot",
            boot_time_unit:"sec",
            repeat: repeat_option[0]
        };
    }

    function repeat_options(val) {
        // removes all error messages when any repeat options is clicked
        if ($("#specific-time-error-row").is(":visible")) {
            $("#specific-time-error-row").hide();
            $("#hr").removeClass("has-error");
            $("#min").removeClass("has-error");
        }
        repeat_option.map(function(item) {
            if(item.index === val)
                timer_unit.repeat = item;
        });
        if (val === 0) {
            $("#specific-time-without-repeat").show();
            $("#repeat-time-option").hide();
            $("#close_button").hide();
            $("#hr").val("00");
            $("#min").val("00");
        } else {
            $("#specific-time-without-repeat").hide();
            $("#repeat-time-option").show();
            repeat_array = [ ];
            repeat_element();
        }
    }

    function repeat_element() {
        var repeat_contents = {
            index: repeat_array.length,
            close: "enabled",
            hours: "00",
            minutes: "00",
            days_value: "1",
            days_text: "Monday",
            date_to_parse: new Date(clock_realtime_now),
            date: moment().format("YYYY-MM-DD")
        };
        if (timer_unit.repeat["index"] === 44640)
            repeat_contents.days_text = "1st";
        sync_repeat();
        repeat_array.push(repeat_contents);
        if (repeat_array.length === 1)
            repeat_array[0].close = "disabled";
        else
            repeat_array[0].close = "enabled";
        display_repeat();
        if (error)
            check_inputs();
    }

    $("#repeat-time-option").on("click", ".btn.btn-default.dropdown-toggle.fa.fa-plus", repeat_element);

    $(".form-table-ct").on("click", ".btn.btn-default.dropdown-toggle.pficon-close", function() {
        sync_repeat();
        repeat_array.splice($(this).attr('data-index'), 1);
        for (var i = 0; i < repeat_array.length; i++) {
            repeat_array[i].index = i;
        }
        if (repeat_array.length === 1)
            repeat_array[0].close = "disabled";
        else
            repeat_array[0].close = "enabled";
        display_repeat();
        if (error)
            check_inputs();
    });

    function display_repeat() {
        $("#repeat-time").html(mustache.render(timer_unit.repeat.render, { repeat: repeat_array }));
        if (timer_unit.repeat["index"] === 525600) {
            var nowDate = new Date(clock_realtime_now);
            var today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 0, 0, 0, 0);
            for (var i = 0; i < repeat_array.length; i++) {
                $("[data-index='"+i+"'][data-content='datepicker']").datepicker({
                    autoclose: true,
                    todayHighlight: true,
                    format: 'yyyy-mm-dd',
                    orientation:"top auto",
                    container:'#timer-dialog',
                    startDate: today
                });
            }
        }
    }

    function sync_repeat() {
        var i = 0;
        if (timer_unit.repeat["index"] === 60) {
            for (; i < repeat_array.length; i++) {
                repeat_array[i].minutes = $("[data-index='"+i+"'][data-content='minutes']").val().trim();
            }
        } else if (timer_unit.repeat["index"] === 1440) {
            for (; i < repeat_array.length; i++) {
                repeat_array[i].minutes = $("[data-index='"+i+"'][data-content='minutes']").val().trim();
                repeat_array[i].hours = $("[data-index='"+i+"'][data-content='hours']").val().trim();
            }
        } else if (timer_unit.repeat["index"] === 10080) {
            for (; i < repeat_array.length; i++) {
                repeat_array[i].minutes = $("[data-index='"+i+"'][data-content='minutes']").val().trim();
                repeat_array[i].hours = $("[data-index='"+i+"'][data-content='hours']").val().trim();
                repeat_array[i].days_text = $("span", $("[data-content='week-days'][data-index='"+i+"']")).first().text();
                repeat_array[i].days_value = $("span", $("[data-content='week-days'][data-index='"+i+"']")).first().attr("value");
            }
        } else if (timer_unit.repeat["index"] === 44640) {
            for (; i < repeat_array.length; i++) {
                repeat_array[i].minutes = $("[data-index='"+i+"'][data-content='minutes']").val().trim();
                repeat_array[i].hours = $("[data-index='"+i+"'][data-content='hours']").val().trim();
                repeat_array[i].days_text = $("span", $("[data-content='month-days'][data-index='"+i+"']")).first().text();
                repeat_array[i].days_value = $("span", $("[data-content='month-days'][data-index='"+i+"']")).first().attr("value");
            }
        } else if (timer_unit.repeat["index"] === 525600) {
            for (; i < repeat_array.length; i++) {
                repeat_array[i].minutes = $("[data-index='"+i+"'][data-content='minutes']").val().trim();
                repeat_array[i].hours = $("[data-index='"+i+"'][data-content='hours']").val().trim();
                repeat_array[i].date_to_parse = new Date($("[data-index='"+i+"'] .bootstrap-datepicker").val());
                repeat_array[i].date = moment(repeat_array[i].date_to_parse).format('YYYY-MM-DD');
            }
        }
    }

    function set_boot_or_calendar(value) {
        if (value == 1) {
            // boot timer
            $("#boot").show();
            $("#boot-error-row").hide();
            $("#specific-time-without-repeat").hide();
            $("#specific-time-error-row").hide();
            $("#repeat-options").hide();
            $("#repeat-time-option").hide();
            $("#boot-time").val("00");
            $("#boot-time").removeClass("has-error");
            timer_unit.Calendar_or_Boot = "Boot";
        } else if (value == 2) {
            //calendar timer
            $("#boot").hide();
            $("#boot-error-row").hide();
            $("#specific-time-error-row").hide();
            $("#repeat-options").show();
            repeat_options(0);
            $("span", $("#drop-repeat")).first().text("Don't Repeat");
            timer_unit.Calendar_or_Boot = "Calendar";
        }
    }

    function set_boot_time_unit(value) {
        value = Number(value);
        switch (value) {
            case 1 : timer_unit.boot_time_unit = "sec";
                break;
            case 60 : timer_unit.boot_time_unit = "min"; //60sec
                break;
            case 3600 : timer_unit.boot_time_unit = "hr"; //60*60sec
                break;
            case 604800 : timer_unit.boot_time_unit = "weeks";//7*24*60*60sec
                break;
        }
    }
    // Validation of Inputs
    function check_inputs() {
        error = false; // made global to show existing errors when + and x are clicked.
        var str = $("#servicename").val();
        if (str.trim().length < 1) {
            $("#servicename-error").text(_("This field cannot be empty."));
            $("#servicename-error-row").show();
            $("#servicename").addClass('has-error');
            error = true;
        } else if (! /^[a-zA-Z0-9:_.@-]+$/.test(str)) {
            $("#servicename-error").text(_("Only alphabets, numbers, : , _ , . , @ , - are allowed."));
            $("#servicename-error-row").show();
            $("#servicename").addClass('has-error');
            error = true;
        }
        str = $("#description").val().trim();
        if (str.length < 1) {
            $("#description-error").text(_("This field cannot be empty."));
            $("#description-error-row").show();
            $("#description").addClass('has-error');
            error = true;
        }
        str = $("#command").val().trim();
        if (str.length < 1) {
            $("#command-error").text(_("This field cannot be empty."));
            $("#command-error-row").show();
            $("#command").addClass('has-error');
            error = true;
        }
        if (timer_unit.Calendar_or_Boot == "Boot") {
            str = $("#boot-time").val();
            if (!/^[0-9]+$/.test(str.trim())) {
                $("#boot-error").text(_("Invalid number."));
                $("#boot-error-row").show();
                $("#boot-time").addClass('has-error');
                error = true;
            }
        } else {
            //Calendar timer cases
            var i = 0;
            if (timer_unit.repeat["index"] === 0) {
                var hr = $("#hr").val().trim();
                var min = $("#min").val().trim();
                $("#hr-error").text("");
                $("#min-error").text("");
                if (!(/^[0-9]+$/.test(hr) && hr <= 23 && hr >= 0)) {
                    $("#hr-error").text(_("Hour needs to be a number between 0-23"));
                    $("#specific-time-error-row").show();
                    $("#hr").addClass('has-error');
                    error = true;
                }
                if (!(/^[0-9]+$/.test(min) && min <= 59 && min >= 0)) {
                    $("#min-error").text(_("Minute needs to be a number between 0-59"));
                    $("#specific-time-error-row").show();
                    $("#min").addClass('has-error');
                    error = true;
                }
            } else if (timer_unit.repeat["index"] === 60) {
                for (; i < repeat_array.length; i++) {
                    if (!(/^[0-9]+$/.test(repeat_array[i].minutes.trim()) && repeat_array[i].minutes.trim() <= 59 && repeat_array[i].minutes.trim() >= 0)) {
                        $("[data-index='" + i + "'][data-content='minutes']").addClass('has-error');
                        $("[data-index='" + i + "'][data-content='min-error']").text(_("Minute needs to be a number between 0-59"));
                        error = true;
                    }
                }
            } else {
                for (; i < repeat_array.length; i++) {
                    if (!(/^[0-9]+$/.test(repeat_array[i].minutes.trim()) && repeat_array[i].minutes.trim() <= 59 && repeat_array[i].minutes.trim() >= 0)) {
                        error = true;
                        $("[data-index='" + i + "'][data-content='minutes']").addClass('has-error');
                        $("[data-index='" + i + "'][data-content='min-error']").text(_("Minute needs to be a number between 0-59"));
                    }
                    if (!(/^[0-9]+$/.test(repeat_array[i].hours.trim()) && repeat_array[i].hours.trim() <= 23 && repeat_array[i].hours.trim() >= 0)) {
                        error = true;
                        $("[data-index='" + i + "'][data-content='hours']").addClass('has-error');
                        $("[data-index='" + i + "'][data-content='hr-error']").text(_("Hour needs to be a number between 0-23"));
                    }
                    if (timer_unit.repeat["index"] === 525600) {
                        if (isNaN(repeat_array[i].date_to_parse.getTime()) || repeat_array[i].date_to_parse.getTime() < 0) {
                            error = true;
                            $("[data-index='" + i + "'][data-content='datepicker']").addClass('has-error');
                            $("[data-index='" + i + "'][data-content='date-error']").text(_("Invalid date format."));
                        }
                    }
                    if (timer_unit.repeat["index"] === 44640 && repeat_array[i].days_value === '31')
                        $("[data-index='" + i + "'][data-content='day-error']").html(_("This day doesn't exist in all months.<br> The timer will only be executed in months that have 31st."));
                }

            }
        }
        return error;
    }

    function create_timer() {
        sync_repeat();
        var error = check_inputs();
        if (error)
            return false;
        timer_unit.name = $("#servicename").val().replace(/\s/g, '');
        timer_unit.Description = $("#description").val();
        timer_unit.Command = $("#command").val();
        timer_unit.boot_time = $("#boot-time").val();

        if (timer_unit.repeat["index"] === 0) {
            timer_unit.repeat_hour = Number($("#hr").val().trim());
            timer_unit.repeat_minute = Number($("#min").val().trim());
            var today = new Date(clock_realtime_now);
            timer_unit.OnCalendar = "OnCalendar=" + today.getFullYear() + "-" + (today.getMonth()+1) + "-" + today.getDate() + " " + timer_unit.repeat_hour + ":" + timer_unit.repeat_minute + ":00";
        } else if (timer_unit.repeat["index"] === 60) {
            timer_unit.repeat_minute = repeat_array.map(function (item) {
                return Number(item.minutes);
            });
            timer_unit.OnCalendar = "OnCalendar=*-*-* *:" + timer_unit.repeat_minute + ":00";
        } else if (timer_unit.repeat["index"] === 1440) {
            timer_unit.OnCalendar = repeat_array.map(function (item) {
                return "OnCalendar=*-*-* " + Number(item.hours) + ":" + Number(item.minutes) + ":00";
            });
        } else if (timer_unit.repeat["index"] === 10080) {
            timer_unit.OnCalendar = repeat_array.map(function (item) {
                return "OnCalendar=" + item.days_text.slice(0,3) + " *-*-* " + Number(item.hours) + ":" + Number(item.minutes) + ":00";
            });
        } else if (timer_unit.repeat["index"] === 44640) {
            timer_unit.OnCalendar = repeat_array.map(function (item) {
                return "OnCalendar=*-*-" + item.days_value + " " + Number(item.hours) + ":" + Number(item.minutes) + ":00";
            });
        } else if (timer_unit.repeat["index"] === 525600) {
            timer_unit.OnCalendar = repeat_array.map(function (item) {
                return "OnCalendar=*-" + moment(item.date_to_parse).format('MM') + "-" + moment(item.date_to_parse).format('DD') + " " +Number(item.hours) + ":" + Number(item.minutes) + ":00";
            });
        }
        if (timer_unit.repeat["index"] !== 60)
            timer_unit.OnCalendar = timer_unit.OnCalendar.toString().replace(/,/g,"\n");
        var invalid = create_timer_file();
        if (invalid)
            return false;
        init_units();
        return true;
    }
    function create_timer_file() {
        var unit = "[Unit]\nDescription=";
        var service = "\n[Service]\nExecStart=";
        var timer = "\n[Timer]\n";
        var service_file = unit + timer_unit.Description + service + timer_unit.Command + "\n[Install]\nWantedBy=default.target";
        var timer_file = " ";
        if (timer_unit.Calendar_or_Boot == "Boot") {
            var boottimer = timer +"OnBootSec=" + timer_unit.boot_time + timer_unit.boot_time_unit;
            timer_file = unit + timer_unit.Description + boottimer;
        }
        else if (timer_unit.Calendar_or_Boot == "Calendar") {
            var calendartimer = timer + timer_unit.OnCalendar;
            timer_file = unit + timer_unit.Description + calendartimer;
        }
        // writing to file
        var service_path = "/etc/systemd/system/" + timer_unit.name + ".service";
        var file = cockpit.file(service_path, { superuser: 'try' });
        file.replace(service_file).
            fail(function(error) {
                console.log(error);
            });
        var timer_path = "/etc/systemd/system/" + timer_unit.name + ".timer";
        file = cockpit.file(timer_path, { superuser: 'try' });
        file.replace(timer_file).
            fail(function(error) {
                console.log(error);
            });
    }

    /*
     * Once the document is ready and loaded. Note that
     * nothing is visible until we invoke this function
     * and update() is called.
     */
    systemd_manager.wait(function() {
        systemd_manager.Subscribe().
            fail(function (error) {
                if (error.name != "org.freedesktop.systemd1.AlreadySubscribed" &&
                    error.name != "org.freedesktop.DBus.Error.FileExists")
                    console.warn("Subscribing to systemd signals failed", error);
            });
        update();
    });
});
