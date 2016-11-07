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

"use strict";

var React = require('react');

require('./tooltip.css');

/* A tooltip, styled via Patternfly/Bootstrap.
 *
 * Example:
 *
 *   <Tooltip tip="Insufficient privileges">
 *      <button disabled>Reboot</button>
 *   </ToolTip>
 *
 * Whenever the mouse hovers over the children of a Tooltip,
 * the text (or arbitrary element) in the "tip" property is shown.
 */

var Tooltip = React.createClass({
    getInitialState: function () {
        return { open: false, pos: "top" };
    },
    onMouseover: function () {
        this.setState({ open: true });
    },
    onMouseout: function () {
        this.setState({ open: false });
    },
    render: function () {
        var self = this;

        if (!self.props.tip)
            return self.props.children;

        /* Placement
         *
         * We assume that there is enough space to display the tooltip
         * in its natural width, and that there is either enough space
         * above or below the element that will show the tooltip.
         *
         * If there is enough space above, the tooltip goes to the
         * top, otherwise below.  It is then moved left or right until
         * it is fully visible.
         */

        /* The life of a tooltip
         *
         * The tooltip starts out at position (-10000,0) so that it is
         * well outside its parent.  This seems to give it its natural
         * width without the browser trying to fit it into the parent,
         * which usually results in a undesired tall and narrow
         * layout.
         *
         * On first interaction and before moving it into place, we
         * prevent the tooltip from resizing by setting the "width"
         * and "height" styles to its current dimensions.
         *
         * Once moved into place, it stays where it is and is just
         * raised and lowered in the Z dimension in addition to being
         * made visible and invisible.
         */

        function fixDOMElements(tip) {
            var child = tip && tip.previousElementSibling;

            // Do nothing unless fully mounted
            if (!tip || !child)
                return;

            // Stop resizing
            if (!tip.style.width || !tip.style.height) {
                tip.style.width = tip.offsetWidth + "px";
                tip.style.height = tip.offsetHeight + "px";
            }

            // Position it
            if (tip.offsetLeft === -10000) {
                var left = child.offsetLeft + 0.5*child.offsetWidth - 0.5*tip.offsetWidth;
                var top = child.offsetTop - tip.offsetHeight;

                var arrow = tip.getElementsByClassName("tooltip-arrow")[0];
                var arrow_left = tip.offsetWidth / 2;

                // Figure out where it is on the page
                var abs_left = left, abs_top = top, max_width = child.offsetWidth;
                var el = tip.offsetParent;
                while (el) {
                    abs_left += el.offsetLeft;
                    abs_top += el.offsetTop;
                    max_width = el.offsetWidth;
                    el = el.offsetParent;
                }

                // Move it left/right until it is full in view
                var x_delta = 0;
                if (abs_left < 0)
                    x_delta = -abs_left + 5;
                else if (abs_left + tip.offsetWidth > max_width)
                    x_delta = -(abs_left + tip.offsetWidth - max_width) - 5;
                left += x_delta;
                arrow_left -= x_delta;

                // Move it to bottom if abs_top < 0
                if (abs_top < 0) {
                    top = child.offsetTop + child.offsetHeight;
                    self.setState({ pos: "bottom" });
                }

                tip.style.left = left + "px";
                tip.style.top = top + "px";
                arrow.style.left = arrow_left + "px";
            }

            tip.style.zIndex = self.state.open ? 2000 : -2000;
        }

        var classes = "tooltip " + self.state.pos;
        if (self.state.open)
            classes += " in";

        return (
            <div className="tooltip-ct-outer">
                <div className="tooltip-ct-inner"
                     onMouseover={this.onMouseover}
                     onMouseout={this.onMouseout}>
                    {self.props.children}
                </div>
                <div ref={fixDOMElements} className={classes} style={{ top: 0, left: -10000 }}>
                    <div className="tooltip-arrow"></div>
                    <div className="tooltip-inner">{self.props.tip}</div>
                </div>
            </div>
        );
    }
});

module.exports = {
    Tooltip: Tooltip,
};
