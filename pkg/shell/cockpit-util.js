/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

define([
    "jquery",
    "base1/cockpit",
    "shell/shell"
], function($, cockpit, shell) {

// Used for escaping things in HTML elements and attributes
shell.esc = function esc(str) {
    if (str === null || str === undefined)
        return "";
    var pre = document.createElement('pre');
    var text = document.createTextNode(str);
    pre.appendChild(text);
    return pre.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
};

/*
 * shell.format_delay(ms)
 * @ms: number of milli-seconds
 *
 * Format soconds into a string of "hours, minutes, seconds".
 */

shell.format_delay = function format_delay(d) {
    var seconds = Math.round(d/1000);
    var minutes = Math.floor(seconds / 60);
    var hours = Math.floor(minutes / 60);
    seconds = seconds - minutes*60;
    minutes = minutes - hours*60;

    var s = seconds + " seconds";
    if (minutes > 0)
        s = minutes + " minutes, " + s;
    if (hours > 0)
        s = hours + " hours, " + s;
    return s;
};

shell.find_in_array = function find_in_array(array, elt) {
    for (var i = 0; i < array.length; i++) {
        if (array[i] == elt)
            return true;
    }
    return false;
};

shell.action_btn = function action_btn(func, spec, btn_classes) {
    var direct_btn, indirect_btns, btn;
    var direct_action, disabled;

    direct_btn =
        $('<button>', { 'data-container' : 'body', 'class': 'btn btn-default' })
            .text("")
            .addClass(btn_classes);

    indirect_btns = [ ];
    disabled = [ ];
    spec.forEach (function (s, i) {
        indirect_btns[i] = $('<li>', { 'class': 'presentation' }).
            append(
                $('<a>', { 'role': 'menuitem',
                           'on': { 'click': function (e) {
                                              if (!disabled[i] && !$(e.currentTarget).hasClass('disabled'))
                                                  func (s.action);
                                            }
                                 }
                         }).addClass(btn_classes).addClass(s.btn_classes)
                         .append(
                             $('<span>', { 'class': s.danger? 'text-danger' : '' }).text(s.title)));
        disabled[i] = false;
    });

    btn =
        $('<div>', { 'class': 'btn-group' }).append(
            direct_btn,
            $('<button>', { 'class': 'btn btn-default dropdown-toggle',
                             'data-toggle': 'dropdown'
                          })
                .append(
                    $('<span>', { 'class': 'caret' })),
            $('<ul>', { 'class': 'dropdown-menu',
                        'style': 'right:0px;left:auto;min-width:0;text-align:left',
                        'role': 'menu'
                      }).
                append(indirect_btns));

    function select (a) {
        spec.forEach(function (s, i) {
            if (s.action == a || (a == 'default' && s.is_default)) {
                direct_action = s.action;
                direct_btn.text(s.title);
                direct_btn.toggleClass('btn-danger', s.danger);
                direct_btn.toggleClass('btn-default', !s.danger);
                direct_btn.off('click');
                direct_btn.on('click', function () { func(s.action); });
                direct_btn.prop('disabled', disabled[i]);
            }
        });
    }

    function enable (a, val) {
        if (direct_action == a)
            direct_btn.prop('disabled', !val);
        spec.forEach(function (s, i) {
            if (s.action == a) {
                disabled[i] = !val;
                indirect_btns[i].toggleClass('disabled', !val);
            }
        });
    }

    select ('default');

    $.data(btn[0], 'cockpit-action-btn-funcs', { select: select, enable: enable });
    return btn;
};

shell.action_btn_select = function action_btn_select(btn, action) {
    $.data(btn[0], 'cockpit-action-btn-funcs').select(action);
};

shell.action_btn_enable = function action_btn_enable(btn, action, val) {
    $.data(btn[0], 'cockpit-action-btn-funcs').enable(action, val);
};

shell.select_btn = function select_btn(func, spec) {
    var div, btn;

    function option_mapper(opt) {
        if (opt.group && Array.isArray(opt.group)) {
          var group = $('<optgroup>')
              .attr('label', opt.title ? opt.title : "" )
              .append(opt.group.map(option_mapper));
          return group;
        } else {
          return $('<option>', { value: opt.choice }).text(opt.title);
        }
    }

    btn = $('<select class="form-control">').append(
        spec.map(option_mapper)
    );

    btn.on('change', function () {
        func(btn.val());
    });

    function select (a) {
        // Calling btn.selectpicker('val', a) would trigger the
        // 'change' event, which we don't want.
        btn.val(a);
        btn.selectpicker('render');
    }

    function selected () {
        return btn.val();
    }

    // The selectpicker is implemented by hiding the <select> element
    // and creating new HTML as a sibling of it.  A standalone element
    // like 'btn' can't have siblings (since it doesn't have a
    // parent), so we have to wrap it into a <div>.

    div = $('<div>').append(btn);
    btn.selectpicker();

    $.data(div[0], 'cockpit-select-btn-funcs', { select: select, selected: selected });
    return div;
};

shell.select_btn_select = function select_btn_select(btn, choice) {
    $.data(btn[0], 'cockpit-select-btn-funcs').select(choice);
};

shell.select_btn_selected = function select_btn_selected(btn) {
    return $.data(btn[0], 'cockpit-select-btn-funcs').selected();
};

shell.util = shell.util || { };

function cache_debug() {
    if (window.debugging == "all" || window.debugging == "dbus")
        console.debug.apply(console, arguments);
}

/* - cache = shell.util.make_resource_cache()
 * - resource = cache.get(key, create)
 * - resource.release()
 *
 * Create a cache for objects that are expensive to create.  Calling
 * 'get' will either return an existing object that matches 'key' or
 * execute 'create()' to create a new one.
 *
 * You need to call 'release' on the returned object once you are done
 * with it.  After the last user has released an object, 'close' will
 * be called on that object after a delay.
 */
shell.util.make_resource_cache = make_resource_cache;
function make_resource_cache() {
    var resources = { };

    function get(key, create) {
        var handle;

        handle = resources[key];

        if (!handle) {
            cache_debug("Creating %s", key);
            handle = { refcount: 1, resource: create() };
            resources[key] = handle;

            handle.resource.release = function() {
                cache_debug("Releasing %s", key);
                // Only really release it after a delay
                window.setTimeout(function () {
                    if (!handle.refcount) {
                        console.warn("Releasing unreffed resource");
                    } else {
                        handle.refcount -= 1;
                        if (handle.refcount === 0) {
                            delete resources[key];
                            cache_debug("Closing %s", key);
                            handle.resource.close("unused");
                        }
                    }
                }, 10000);
            };
        } else {
            cache_debug("Getting %s", key);
            handle.refcount += 1;
        }

        return handle.resource;
    }

    return { get: get };
}

/* - shell.util.machine_info(address).done(function (info) { })
 *
 * Get information about the machine at ADDRESS.  The returned object
 * has these fields:
 *
 * memory  -  amount of physical memory
 */

var machine_info_promises = { };

shell.util.machine_info = machine_info;
function machine_info(address) {
    var pr = machine_info_promises[address];
    var dfd;
    if (!pr) {
        dfd = $.Deferred();
        machine_info_promises[address] = pr = dfd.promise();

        cockpit.spawn(["cat", "/proc/meminfo", "/proc/cpuinfo"], { host: address }).
            done(function(text) {
                var info = { };
                var match = text.match(/MemTotal:[^0-9]*([0-9]+) [kK]B/);
                var total_kb = match && parseInt(match[1], 10);
                if (total_kb)
                    info.memory = total_kb*1024;

                info.cpus = 0;
                var re = new RegExp("^processor", "gm");
                while (re.test(text))
                    info.cpus += 1;
                dfd.resolve(info);
            }).
            fail(function() {
                dfd.reject();
            });
    }
    return pr;
}

/* - name = shell.util.hostname_for_display(interface)
 *
 * Return the name of the machine that INTERFACE is connected to.
 * INTERFACE should be a DBusInterface with PrettyHostname and
 * StaticHostname properties.
 */

shell.util.hostname_for_display = hostname_for_display;
function hostname_for_display(iface) {
    if (iface.PrettyHostname)
        return iface.PrettyHostname;
    else if (iface.StaticHostname &&
        iface.StaticHostname != "localhost" &&
        iface.StaticHostname != "localhost.localdomain")
        return iface.StaticHostname;
    else if (iface._client && iface._client.target != "localhost")
        return iface._client.target;
    else if (iface.client && iface.client.options.host && iface.client.options.host != "localhost")
        return iface.client.options.host;
    else
        return window.location.hostname;
}

});
