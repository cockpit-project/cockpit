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

   - host (string)

   The address of the default host to connect to.

   - path (array of strings)

   The path to the page, such as [ "storage", "block", "vda" ].

   - options (dict of strings to strings)

   The display options of the page, such as { collapse: "all" }.

   'host' and 'path' are constant for the life-time of a page, but
   'options' might change.  A page will be notified about this in some
   to-be-specified way.  (Legacy pages will get a leave/enter
   sequence.)  A page can also change the options.

   Guarantees: 'host' is always a non-empty string.  'path' has always
   at least length 1.  'options' is always a dict.
*/

cockpit.hash.encode_page_hash = function encode_page_hash(params) {
    var full_path = params.path;
    var host = params.host;
    if (host !== false) {
        if (!host || host == "localhost")
            host = "local";
        full_path = [ host ].concat(full_path);
    }

    var res = "/" + full_path.map(encodeURIComponent).join("/");
    var query = [];
    for (var opt in params.options) {
        if (params.options.hasOwnProperty(opt))
            query.push(encodeURIComponent(opt) + "=" + encodeURIComponent(params.options[opt]));
    }
    if (query.length > 0)
        res += "?" + query.join("&");
    return "#" + res;
};

cockpit.hash.decode_page_hash = function decode_page_hash(hash) {
    var params = { host: "localhost", path: [ "dashboard" ], options: { } };

    if (hash[0] == '#')
        hash = hash.substr(1);

    var query = hash.split('?');

    var path = query[0].split('/').map(decodeURIComponent);
    if (path[0] === "")
        path.shift();
    if (path[path.length-1] === "")
        path.length--;

    if (path.length > 0) {
        params.host = path.shift();
        if (params.host === "" || params.host == "local")
            params.host = "localhost";
    }

    if (path.length > 0)
        params.path = path;

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
