define([
    "jquery",
    "base1/cockpit",
    "base1/mustache",
    "system/server",
    "translated!base1/po"
], function($, cockpit, mustache, server, po) {
    cockpit.locale(po);
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

        var units_template = $("#services-units-tmpl").html();
        mustache.parse(units_template);

        function render_now() {
            var pattern = $('#services-filter button.active').attr('data-pattern');

            function cmp_path(a, b) { return units_by_path[a].Id.localeCompare(units_by_path[b].Id); }
            var sorted_keys = Object.keys(units_by_path).sort(cmp_path);
            var enabled = [ ], disabled = [ ], statics = [ ];

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
                        UnitFileState: state[1]
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
     * Another even simpler special case are invalid units
     * (cur_unit_error is true).
     */

    var cur_unit_id;
    var cur_unit;
    var cur_unit_file_state;
    var cur_unit_is_template;
    var cur_unit_template;
    var cur_unit_error;
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
                                           LoadError: cur_unit.LoadError[1],
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

        cur_journal_watcher = server.logbox([ "_SYSTEMD_UNIT=" + cur_unit_id, "+",
                                              "COREDUMP_UNIT=" + cur_unit_id, "+",
                                              "UNIT=" + cur_unit_id ], 10);
        $('#service-log').empty().append(cur_journal_watcher);
    }

    function unit_goto() {
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

    function init() {
        systemd_manager.wait(function () {
            systemd_manager.Subscribe().
                fail(function (error) {
                    if (error.name != "org.freedesktop.systemd1.AlreadySubscribed" &&
                        error.name != "org.freedesktop.DBus.Error.FileExists")
                        console.warn("Subscribing to systemd signals failed", error);
                });
            update();
        });
    }

    $(cockpit).on("locationchanged", update);

    $('#service-navigate-home').on("click", function() {
        cockpit.location.go('/');
    });

    $('body').on('click', "[data-goto-unit]", unit_goto);

    $('#service-template').on('click', 'button', function () {
        unit_instantiate($('#service-template input').val());
    });

    return init;
});
