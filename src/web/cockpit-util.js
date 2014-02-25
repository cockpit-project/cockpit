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

// Used for escaping things in HTML elements and attributes
function cockpit_esc(str) {
    var pre = document.createElement('pre');
    var text = document.createTextNode(str);
    pre.appendChild(text);
    return pre.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Used for escaping things in HTML id attribute values
//
// http://www.w3.org/TR/html5/global-attributes.html#the-id-attribute
function cockpit_esc_id_attr(str) {
    return cockpit_esc(str).replace(/ /g, "&#20;").replace(/\x09/g, "&#09;").replace(/\x0a/g, "&#0a;").replace(/\x0c/g, "&#0c;").replace(/\x0d/g, "&#0d;");
}

function cockpit_debug(str) {
    console.debug("DEBUG: " + str);
}

function cockpit_bind_dbus_property(id, object, property) {
    var callback = function () {
	var stringified = object[property].toString();
	$(id).empty();
	$(id).append(document.createTextNode(stringified));
    };
    $(object).on("notify:" + property, callback);
    callback();
}

function cockpit_bind_dbus_property_func(id, object, func) {
    var callback = function () {
	var stringified = func(object);
	$(id).empty();
	$(id).append(document.createTextNode(stringified));
    };
    $(object).on("notify", callback);
    callback();
}

function cockpit_format_bytes(num_bytes) {
    if (num_bytes < 1000*1000)
        return (num_bytes/(1000)).toFixed(1) + " kB";
    else if (num_bytes < 1000*1000*1000)
        return (num_bytes/(1000*1000)).toFixed(1) + " MB";
    else if (num_bytes < 1000*1000*1000*1000)
        return (num_bytes/(1000*1000*1000)).toFixed(1) + " GB";
    else if (num_bytes < 1000*1000*1000*1000*1000)
        return (num_bytes/(1000*1000*1000*1000)).toFixed(1) + " TB";
    else if (num_bytes < 1000*1000*1000*1000*1000*1000)
        return (num_bytes/(1000*1000*1000*1000*1000)).toFixed(1) + " PB";
    else if (num_bytes < 1000*1000*1000*1000*1000*1000*1000)
        return (num_bytes/(1000*1000*1000*1000*1000*1000)).toFixed(1) + " EB";
    else
        return (num_bytes/(1000*1000*1000*1000*1000*1000*1000)).toFixed(1) + " ZB";
}

function cockpit_format_bytes_pow2(num_bytes) {
    if (num_bytes < 1024*1024)
        return (num_bytes/(1024)).toFixed(1) + " KiB";
    else if (num_bytes < 1024*1024*1024)
        return (num_bytes/(1024*1024)).toFixed(1) + " MiB";
    else if (num_bytes < 1024*1024*1024*1024)
        return (num_bytes/(1024*1024*1024)).toFixed(1) + " GiB";
    else if (num_bytes < 1024*1024*1024*1024*1024)
        return (num_bytes/(1024*1024*1024*1024)).toFixed(1) + " TiB";
    else if (num_bytes < 1024*1024*1024*1024*1024*1024)
        return (num_bytes/(1024*1024*1024*1024*1024)).toFixed(1) + " PiB";
    else if (num_bytes < 1024*1024*1024*1024*1024*1024*1024)
        return (num_bytes/(1024*1024*1024*1024*1024*1024)).toFixed(1) + " EiB";
    else
        return (num_bytes/(1024*1024*1024*1024*1024*1024*1024)).toFixed(1) + " ZiB";
}

function cockpit_format_delay(d) {
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
}

function cockpit_add_thousands_separators(number)
{
    /* Translators: Thousands-separator ("," in en_US, "." in da_DK and so on) */
    var separator_char = C_("thousands-separator", ",");
    number += '';
    var x = number.split('.');
    var x1 = x[0];
    var x2 = x.length > 1 ? '.' + x[1] : '';
    var rgx = /(\d+)(\d{3})/;
    while (rgx.test(x1)) {
	x1 = x1.replace(rgx, "$1" + separator_char + "$2");
    }
    return x1 + x2;
}

function cockpit_format_bytes_long(num_bytes) {
    var with_unit = cockpit_format_bytes(num_bytes);
    var with_pow2_unit = cockpit_format_bytes_pow2(num_bytes);
    var with_sep = cockpit_add_thousands_separators(num_bytes);
    /* Translators: Used in "42.5 kB (42,399 bytes)" */
    return with_unit + " (" + with_pow2_unit + ", " + with_sep + " " + C_("format-bytes", "bytes") + ")";
}

function cockpit_format_bytes_per_sec(num_bytes) {
    return cockpit_format_bytes(num_bytes) + "/s";
}

function cockpit_format_temperature(kelvin) {
    var celcius = kelvin - 273.15;
    var fahrenheit = 9.0 * celcius / 5.0 + 32.0;
    return celcius.toFixed(1) + "° C / " + fahrenheit.toFixed(1) + "° F";
}

// ----------------------------------------------------------------------------------------------------

function cockpit_array_remove(array, value)
{
    /* not exactly idiomatic */
    array.splice(array.indexOf(value), 1);
}

// ----------------------------------------------------------------------------------------------------

function cockpit_diff_sorted_lists(existing, wanted, added, removed, unchanged)
{
    var n = 0, m = 0;

    existing.sort();
    wanted.sort();

    while (n < existing.length && m < wanted.length) {
        if (existing[n] < wanted[m]) {
            if (removed)
                removed.push(existing[n]);
            n++;
        } else if (existing[n] > wanted[m]) {
            if (added)
                added.push(wanted[n]);
            m++;
        } else {
            if (unchanged)
                unchanged.push(existing[n]);
            n++;
            m++;
        }
    }

    while (n < existing.length) {
        if (removed)
            removed.push(existing[n]);
        n++;
    }

    while (m < wanted.length) {
        if (added)
            added.push(wanted[m]);
        m++;
    }
}

function cockpit_settings_get(key) {
    var ret = null;
    if (localStorage) {
        ret = localStorage.getItem(key);
    }
    return ret;
}

function cockpit_settings_set(key, value) {
    if (localStorage) {
        if (value)
            localStorage.setItem(key, value);
        else
            localStorage.removeItem(key);
    }
}

function cockpit_settings_get_json(key) {
    var val = cockpit_settings_get (key);
    if (val)
        val = JSON.parse (val);
    return val;
}

function cockpit_settings_set_json(key, val) {
    cockpit_settings_set (key, JSON.stringify (val));
}

function _is_non_blank(str) {
    return str.search(/\S/) != -1;
}

function cockpit_set_text(node, val) {
    if (node.nodeType == 3) {
        if (_is_non_blank($(node.parentNode).text()))
            $(node.parentNode).text(val);
    }

    if (node.childNodes) {
        for(var n = 0; n < node.childNodes.length; n++) {
            var child = node.childNodes[n];
            cockpit_set_text(child, val);
        }
    }
}

function cockpit_get_display_hostname()
{
    var h;
    if (cockpit_dbus_client && cockpit_dbus_client.state == "ready") {
        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager",
                                                 "com.redhat.Cockpit.Manager");
        if (manager) {
            h = manager.PrettyHostname;
            if (!h)
                h = manager.Hostname;
        }
    }
    if (!h)
        h = cockpitdyn_pretty_hostname;
    if (!h)
        h = cockpitdyn_hostname;

    return h;
}

if (typeof String.prototype.endsWith !== 'function') {
    String.prototype.endsWith = function(suffix) {
        return this.length >= suffix.length && this.indexOf(suffix, this.length - suffix.length) !== -1;
    };
}

function cockpit_make_set (array) {
    var s = { };
    for (var i = 0; i < array.length; i++)
        s[array[i]] = true;
    return s;
}

function cockpit_find_in_array (array, elt) {
    for (var i = 0; i < array.length; i++) {
        if (array[i] == elt)
            return true;
    }
    return false;
}

function cockpit_action_btn (func, spec) {
    var direct_btn, indirect_btns, btn;
    var direct_action, disabled;

    direct_btn =
        $('<button>', { 'class': 'btn' }).text("");

    indirect_btns = [ ];
    disabled = [ ];
    spec.forEach (function (s, i) {
        indirect_btns[i] = $('<li>', { 'class': 'presentation' }).
            append(
                $('<a>', { 'role': 'menuitem',
                           'on': { 'click': function () {
                                              if (!disabled[i])
                                                  func (s.action);
                                            }
                                 }
                         }).append(
                             $('<span>', { 'class': s.danger? 'text-danger' : '' }).text(s.title)));
        disabled[i] = false;
    });

    btn =
        $('<div>', { 'class': 'btn-group' }).append(
            direct_btn,
            $('<button>', { 'class': 'btn btn-default dropdown-toggle',
                             'data-toggle': 'dropdown'
                          }).
                append(
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
}

function cockpit_action_btn_select (btn, action) {
    $.data(btn[0], 'cockpit-action-btn-funcs').select(action);
}

function cockpit_action_btn_enable (btn, action, val) {
    $.data(btn[0], 'cockpit-action-btn-funcs').enable(action, val);
}
