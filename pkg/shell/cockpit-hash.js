/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

var cockpit = cockpit || { };

(function(cockpit) {

cockpit.hash = cockpit.hash || { };

/* Page navigation parameters

   The parameters of the current page are stored in a dict with these
   fields:

   - path (array of strings)

   The path to the page, such as [ "f21", "storage", "block", "vda" ].

   - options (dict of strings to strings)

   The display options of the page, such as { collapse: "all" }.
*/

cockpit.hash.encode = function encode(params) {
    var res = "/" + params.path.map(encodeURIComponent).join("/");
    var query = [];
    for (var opt in params.options) {
        if (params.options.hasOwnProperty(opt))
            query.push(encodeURIComponent(opt) + "=" + encodeURIComponent(params.options[opt]));
    }
    if (query.length > 0)
        res += "?" + query.join("&");
    return "#" + res;
};

cockpit.hash.decode = function decode(hash) {
    var params = { };

    if (hash[0] == '#')
        hash = hash.substr(1);

    var query = hash.split('?');

    var path = query[0].split('/').map(decodeURIComponent);
    if (path[0] === "")
        path.shift();
    if (path[path.length-1] === "")
        path.length--;

    params.path = path;

    params.options = { };
    if (query.length > 1) {
        var opts = query[1].split("&");
        for (var i = 0; i < opts.length; i++) {
            var parts = opts[i].split('=');
            params.options[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
        }
    }

    return params;
};

})(cockpit);
