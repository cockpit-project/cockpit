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

define([
    "jquery",
    "base1/cockpit",
    "base1/mustache",
    "translated!base1/po",
], function($, cockpit, mustache, po) {
    /* setting the locale and translating should only happen in the main js file of a package */
    cockpit.locale(po);

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    /* a sample function we use in the test */
    function test_function() {
        return 1;
    }

    /* we call this from index.html */
    function init_page() {
        $('#unsupported').show();
    }

    return {
        init: init_page,
        test_function: test_function
    };

});
