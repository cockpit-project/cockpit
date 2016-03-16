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
    "shell/shell",
], function($, cockpit, shell) {

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

if (!shell.util)
    shell.util = { };

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

});
