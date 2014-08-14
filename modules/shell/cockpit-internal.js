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

(function(cockpit, $){

PageInternal.prototype = {
    _init: function() {
        this.id = "internal";
        this.history = [ "" ];
        this.history_pos = 0;
        this.term = null;
        this.channel = null;
    },

    getTitle: function() {
        return C_("page-title", "Internal Debugging");
    },

    show: function() {
    },

    setup: function() {
        $(".cockpit-internal-reauthorize .btn").on("click", function() {
            $(".cockpit-internal-reauthorize span").text("checking...");
            var cmd = "pkcheck --action-id org.freedesktop.policykit.exec --process $$ -u 2>&1";
            cockpit.spawn(["sh", "-c", cmd]).
                stream(function(data) {
                    console.debug(data);
                }).
                done(function() {
                    $(".cockpit-internal-reauthorize span").text("result: authorized");
                }).
                fail(function() {
                    $(".cockpit-internal-reauthorize span").text("result: not-authorized");
                });
        });
    },

    enter: function() {
    },

    leave: function() {
    }
};

function PageInternal() {
    this._init();
}

cockpit.pages.push(new PageInternal());

})(cockpit, jQuery);
