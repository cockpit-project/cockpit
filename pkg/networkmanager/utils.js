/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

    var cockpit = require("cockpit");

    var _ = cockpit.gettext;

    /* NetworkManager specific data conversions and utility functions.
     */

    var byteorder;

    function set_byteorder(bo) {
        byteorder = bo;
    }

    function ip_prefix_to_text(num) {
        return num.toString();
    }

    function ip_prefix_from_text(text) {
        if (/^[0-9]+$/.test(text.trim()))
            return parseInt(text, 10);

        throw cockpit.format(_("Invalid prefix $0"), text);
    }

    function ip_metric_to_text(num) {
        return num.toString();
    }

    function ip_metric_from_text(text) {
        if (text === "")
            return 0;

        if (/^[0-9]+$/.test(text.trim()))
            return parseInt(text, 10);

        throw cockpit.format(_("Invalid metric $0"), text);
    }

    function toDec(n) {
        return n.toString(10);
    }

    function bytes_from_nm32(num) {
        var bytes = [], i;
        if (byteorder == "be") {
            for (i = 3; i >= 0; i--) {
                bytes[i] = num & 0xFF;
                num = num >>> 8;
            }
        } else {
            for (i = 0; i < 4; i++) {
                bytes[i] = num & 0xFF;
                num = num >>> 8;
            }
        }
        return bytes;
    }

    function ip4_to_text(num, zero_is_empty) {
        if (num === 0 && zero_is_empty)
            return "";
        return bytes_from_nm32(num).map(toDec).join('.');
    }

    function ip4_from_text(text, empty_is_zero) {
        function invalid() {
            throw cockpit.format(_("Invalid address $0"), text);
        }

        if (text === "" && empty_is_zero)
            return 0;

        var parts = text.split('.');
        if (parts.length != 4)
            invalid();

        var bytes = parts.map(function(s) {
            if (/^[0-9]+$/.test(s.trim()))
                return parseInt(s, 10);
            else
                invalid();
        });

        var num = 0;
        function shift(b) {
            if (isNaN(b) || b < 0 || b > 0xFF)
                invalid();
            num = 0x100*num + b;
        }

        var i;
        if (byteorder == "be") {
            for (i = 0; i < 4; i++) {
                shift(bytes[i]);
            }
        } else {
            for (i = 3; i >= 0; i--) {
                shift(bytes[i]);
            }
        }

        return num;
    }

    var text_to_prefix_bits = {
        "255": 8, "254": 7, "252": 6, "248": 5, "240": 4, "224": 3, "192": 2, "128": 1, "0": 0
    };

    function ip4_prefix_from_text(text) {
        function invalid() {
            throw cockpit.format(_("Invalid prefix or netmask $0"), text);
        }

        if (/^[0-9]+$/.test(text.trim()))
            return parseInt(text, 10);
        var parts = text.split('.');
        if (parts.length != 4)
            invalid();
        var prefix = 0;
        var i;
        for (i = 0; i < 4; i++) {
            var p = text_to_prefix_bits[parts[i].trim()];
            if (p !== undefined) {
                prefix += p;
                if (p < 8)
                    break;
            } else
                invalid();
        }
        for (i += 1; i < 4; i++) {
            if (/^0+$/.test(parts[i].trim()) === false)
                invalid();
        }
        return prefix;
    }

    function ip6_to_text(data, zero_is_empty) {
        var parts = [];
        var bytes = cockpit.base64_decode(data);
        for (var i = 0; i < 8; i++)
            parts[i] = ((bytes[2*i] << 8) + bytes[2*i+1]).toString(16);
        var result = parts.join(':');
        if (result == "0:0:0:0:0:0:0:0" && zero_is_empty)
            return "";
        return result;
    }

    function ip6_from_text(text, empty_is_zero) {
        function invalid() {
            throw cockpit.format(_("Invalid address $0"), text);
        }

        if (text === "" && empty_is_zero)
            return cockpit.base64_encode([ 0, 0, 0, 0, 0, 0, 0, 0,
                                           0, 0, 0, 0, 0, 0, 0, 0,
                                         ]);

        var parts = text.split(':');
        if (parts.length < 1 || parts.length > 8)
            invalid();

        if (parts[0] === "")
            parts[0] = "0";
        if (parts[parts.length-1] === "")
            parts[parts.length-1] = "0";

        var bytes = [], n, i, j;
        var empty_seen = false;
        for (i = 0, j = 0; i < parts.length; i++, j++) {
            if (parts[i] === "") {
                if (empty_seen)
                    invalid();
                empty_seen = true;
                while (j < i + (8 - parts.length)) {
                    bytes[2*j] = bytes[2*j+1] = 0;
                    j++;
                }
            } else {
                if (!/^[0-9a-fA-F]+$/.test(parts[i].trim()))
                    invalid();
                n = parseInt(parts[i], 16);
                if (isNaN(n) || n < 0 || n > 0xFFFF)
                    invalid();
                bytes[2*j] = n >> 8;
                bytes[2*j+1] = n & 0xFF;
            }
        }
        if (j != 8)
            invalid();

        return cockpit.base64_encode(bytes);
    }

    module.exports = {
        set_byteorder: set_byteorder,

        ip_prefix_to_text: ip_prefix_to_text,
        ip_prefix_from_text: ip_prefix_from_text,
        ip_metric_to_text: ip_metric_to_text,
        ip_metric_from_text: ip_metric_from_text,

        ip4_to_text: ip4_to_text,
        ip4_from_text: ip4_from_text,
        ip4_prefix_from_text: ip4_prefix_from_text,

        ip6_to_text: ip6_to_text,
        ip6_from_text: ip6_from_text
    };

})();
