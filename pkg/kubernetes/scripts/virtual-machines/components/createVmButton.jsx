/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import cockpit from 'cockpit';

import React from 'react';
import DialogPattern from 'cockpit-components-dialog.jsx';
import CreateVmDialog from './createVmDialog.jsx';
import { vmCreate } from '../kube-middleware.jsx';

import { mouseClick } from '../utils.jsx';

const _ = cockpit.gettext;

class CreateVmButton extends React.Component {
    constructor(props) {
        super(props);

        this.createVmDialog = this.createVmDialog.bind(this);
    }

    createVmDialog() {
        let dialog = null;

        const dialogProps = {
            title: _("Create Virtual Machine"),
            body: (
                <CreateVmDialog ref={ d => { dialog = d; return d } } />
            ),
        };

        // also test modifying properties in subsequent render calls
        const footerProps = {
            actions: [
                {
                    clicked: () => {
                        if (dialog) {
                            const v = dialog.validate();
                            dialog.showErrors(v.errors); // if no errors, then clear old errors
                            if (v.success) {
                                return vmCreate(v.result.resource);
                            } else {
                                return cockpit.reject(_("Resolve above errors to continue"));
                            }
                        }
                    },
                    caption: _("Create"),
                    style: 'primary',
                },
            ],
        };

        DialogPattern.show_modal_dialog(dialogProps, footerProps);
    }

    render() {
        return (
            <a className="card-pf-link-with-icon pull-right" id="create-new-vm"
                onClick={mouseClick(this.createVmDialog)}>
                <span className="pficon pficon-add-circle-o" />{_("Create")}
            </a>
        );
    }
}

export default CreateVmButton;
