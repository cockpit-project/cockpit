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

define([
    "base1/cockpit",
    "./react",
], function(cockpit, React) {

"use strict";
var _ = cockpit.gettext;

/* Performance profile entry
 * Expected props:
 *  - name (key)
 *  - recommended (boolean)
 *  - active (boolean)
 *  - selected (boolean)
 *  - title
 *  - description
 *  - click (callback function)
 */
var TunedDialogProfile = React.createClass({
    propTypes: {
        name: React.PropTypes.string.isRequired,
        recommended: React.PropTypes.bool.isRequired,
        active: React.PropTypes.bool.isRequired,
        selected: React.PropTypes.bool.isRequired,
        title: React.PropTypes.string.isRequired,
        description: React.PropTypes.string.isRequired,
        click: React.PropTypes.func.isRequired,
    },
    render: function() {
        var classes = "list-group-item";
        if (this.props.selected)
            classes += " active";
        var recommended;
        if (this.props.recommended)
            recommended = <span className="badge pull-right">{ _("recommended") }</span>;
        return (
            <div className={ classes } key={ this.props.name } onClick={ this.props.click }>
                {recommended}
                <p>{ this.props.title }</p>
                <small>{ this.props.description }</small>
            </div>
        );
    }
});

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
var TunedDialogBody = React.createClass({
    propTypes: {
        active_profile: React.PropTypes.string.isRequired,
        change_selected: React.PropTypes.func.isRequired,
        profiles: React.PropTypes.array.isRequired,
    },
    getInitialState: function() {
        return {
            selected_profile: this.props.active_profile,
        };
    },
    handleProfileClick: function(profile) {
        if (profile != this.state.selected_profile) {
            this.setState( { selected_profile: profile } );
            this.props.change_selected(profile);
        }
    },
    render: function() {
        var self = this;
        var profiles = this.props.profiles.map(function(itm) {
            itm.active = (self.props.active_profile == itm.profile);
            itm.selected = (self.state.selected_profile == itm.name);
            itm.click = self.handleProfileClick.bind(self, itm.name);
            return <TunedDialogProfile { ...itm }/>;
        });
        return (
            <div className="modal-body">
                <div className="list-group dialog-list-ct">
                    { profiles }
                </div>
            </div>
        );
    }
});

return TunedDialogBody;
});
