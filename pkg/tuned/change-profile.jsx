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

import cockpit from "cockpit";
import React from "react";
import PropTypes from "prop-types";

import { Label, Menu, MenuItem, MenuContent, MenuList, Flex, FlexItem } from '@patternfly/react-core';

import "menu-select-widget.scss";

const _ = cockpit.gettext;

/* dialog body with list of performance profiles
 * Expected props:
 *  - active_profile (key of the active profile)
 *  - change_selected callback, called with profile name each time the selected entry changes
 *  - profiles (array of entries passed to TunedDialogProfile)
 *    - name (string, key)
 *    - recommended (boolean)
 *    - active (boolean)
 *    - title (string)
 *    - description (string)
 */
export class TunedDialogBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            selected_profile: this.props.active_profile,
        };
    }

    render() {
        const profiles = this.props.profiles.map((itm) => {
            const active = this.props.active_profile == itm.name;

            return (
                <MenuItem itemId={itm.name} key={itm.name} data-value={itm.name} description={itm.description}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }}>
                        <p>{ itm.title }</p>
                        <FlexItem>
                            {itm.recommended && <Label color="blue" variant='filled'>{_("recommended")}</Label>}
                            {" "}
                            {active && <Label color="blue" variant='filled'>{_("active")}</Label>}
                        </FlexItem>
                    </Flex>
                </MenuItem>
            );
        });
        return (
            <Menu className="ct-menu-select-widget"
                  onSelect={(_, selected) => {
                      this.setState({ selected_profile: selected });
                      this.props.change_selected(selected);
                  }}
                  activeItemId={this.state.selected_profile}
                  selected={this.state.selected_profile}>
                <MenuContent>
                    <MenuList>
                        {profiles}
                    </MenuList>
                </MenuContent>
            </Menu>
        );
    }
}
TunedDialogBody.propTypes = {
    active_profile: PropTypes.string.isRequired,
    change_selected: PropTypes.func.isRequired,
    profiles: PropTypes.array.isRequired,
};
