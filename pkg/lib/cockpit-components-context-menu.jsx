/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React from "react";
import PropTypes from "prop-types";

import { Menu, MenuContent } from "@patternfly/react-core/dist/esm/components/Menu";

import "context-menu.scss";

/*
 * A context menu component
 *
 * It requires two properties:
 *  - parentId, area in which it listens to left button click
 *  - children, a MenuList to be rendered in the context menu
 */
export const ContextMenu = ({ parentId, children }) => {
    const [visible, setVisible] = React.useState(false);
    const [event, setEvent] = React.useState(null);
    const root = React.useRef(null);

    React.useEffect(() => {
        const _handleContextMenu = (event) => {
            event.preventDefault();

            setVisible(true);
            setEvent(event);
        };

        const _handleClick = (event) => {
            if (event && event.button === 0) {
                const wasOutside = !(event.target.contains === root.current);

                if (wasOutside)
                    setVisible(false);
            }
        };

        const parent = document.getElementById(parentId);
        parent.addEventListener('contextmenu', _handleContextMenu);
        document.addEventListener('click', _handleClick);

        return () => {
            parent.removeEventListener('contextmenu', _handleContextMenu);
            document.removeEventListener('click', _handleClick);
        };
    }, [parentId]);

    React.useEffect(() => {
        if (!event)
            return;

        const clickX = event.clientX;
        const clickY = event.clientY;
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const rootW = root.current.offsetWidth;
        const rootH = root.current.offsetHeight;

        const right = (screenW - clickX) > rootW;
        const left = !right;
        const top = (screenH - clickY) > rootH;
        const bottom = !top;

        if (right) {
            root.current.style.left = `${clickX + 5}px`;
        }

        if (left) {
            root.current.style.left = `${clickX - rootW - 5}px`;
        }

        if (top) {
            root.current.style.top = `${clickY + 5}px`;
        }

        if (bottom) {
            root.current.style.top = `${clickY - rootH - 5}px`;
        }
    }, [event]);

    return visible &&
        <Menu ref={root} className="contextMenu">
            <MenuContent ref={root}>
                {children}
            </MenuContent>
        </Menu>;
};

ContextMenu.propTypes = {
    parentId: PropTypes.string.isRequired,
    children: PropTypes.any
};
