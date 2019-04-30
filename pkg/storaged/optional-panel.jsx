/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import { install_dialog } from "cockpit-components-install-dialog.jsx";
import { StorageButton } from "./storage-controls.jsx";

const _ = cockpit.gettext;

/* OptionalPanel - a panel that is only visible when a certain feature
                   has been detected.  It can also install missing packages
                   to enable that feature.

   Properties:

   - client: The storage client
   - title: Title of the panel
   - actions: Buttons to show in the heading when the feature is enabled
   - children: For the body of the panel when the feature is enabled

   - feature: The feature object, see below.
   - not_installed_text: The text to show in the panel body when the feature is not enabled.
   - install_title: The text in the button that lets the user enable the feature at run time.

   When the "feature" property is omitted (or false), the panel will always be shown.
   Otherwise, the feature object determines what happens.  It has the following fields:

   - is_enabled:  A function that should return whether the feature is enabled.  This
                  function is called during rendering and thus needs to be fast and synchronous.

   - package:     The name of tha package to install.  If omitted or false, the feature
                  can not be enabled at run-time and the panel will be fully invisible
                  if not already enabled.

   - enable:      A function that is called once support for the feature has been
                  successfully installed.  Subsequent calls to "is_enabled" should return true.
*/

export class OptionalPanel extends React.Component {
    constructor() {
        super();
        this.state = { promise: null,
                       error: null,
                       progress: null,
                       just_installed: false,
        };
    }

    render() {
        var self = this;
        var { actions, className, id, title,
              feature, not_installed_text, install_title } = this.props;

        var feature_enabled = !feature || feature.is_enabled();
        var required_package = feature && feature.package;

        if (!feature_enabled && !(required_package && this.props.client.features.packagekit))
            return null;

        function install() {
            install_dialog(required_package).then(() => {
                feature.enable();
                self.setState({ just_installed: "just-installed" });
                window.setTimeout(() => { self.setState({ just_installed: "just-installed faded" }) },
                                  4000);
            },
                                                  () => null /* ignore cancel */);
        }

        var heading_right = null;
        if (!feature_enabled) {
            heading_right = <StorageButton kind="primary" onClick={install}>{install_title}</StorageButton>;
        } else {
            heading_right = (
                <React.Fragment>
                    { this.state.just_installed
                        ? <span className={this.state.just_installed}>{_("Support is installed.")}</span>
                        : null
                    }
                    { actions }
                </React.Fragment>
            );
        }

        return (
            <div className={"panel panel-default " + className} id={id}>
                <div className="panel-heading">
                    <h2 className="panel-title">{title}</h2>
                    <div className="panel-actions">
                        { heading_right }
                    </div>
                </div>
                { feature_enabled
                    ? this.props.children
                    : <div className="empty-panel-text">{not_installed_text}</div>
                }
            </div>
        );
    }
}
