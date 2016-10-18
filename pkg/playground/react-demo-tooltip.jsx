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

    var React = require("react");

    var Tooltip = require("cockpit-components-tooltip.jsx").Tooltip;

    function showTooltipDemo (element, top_element) {
        var tip = <span>The user <b>junior</b> is not permitted to manage storage</span>;

        var tooltip = (
            <table width="100%">
                <tr>
                    <td className="text-left">
                        <Tooltip tip={tip} pos="top">
                            <button className="btn btn-default">Too</button>
                        </Tooltip> close to left edge
                    </td>
                    <td className="text-center">
                        <Tooltip tip={tip} pos="top">
                            <button className="btn btn-default">Enough space all around</button>
                        </Tooltip>
                    </td>
                    <td className="text-right">
                        Too close to right <Tooltip tip={tip} pos="top">
                        <button className="btn btn-default">edge</button>
                        </Tooltip>
                    </td>
                </tr>
            </table>
        );

        React.render(tooltip, element);

        var top_tooltip = (
            <center>
                <Tooltip tip={tip} pos="top">
                    <button className="btn btn-default">Too close to top edge</button>
                </Tooltip>
            </center>
        );

        React.render(top_tooltip, top_element);
    }

    module.exports = {
        demo: showTooltipDemo,
    };
}());
