/*jshint esversion: 6 */
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
import React, { PropTypes } from "react";
import DialogPattern from 'cockpit-components-dialog.jsx';
import Select from "cockpit-components-select.jsx";
import { createVm } from '../actions.es6';

const _ = cockpit.gettext;

/* Create a virtual machine
 * props:
 *  - initialName initial proposed name for the VM
 *  - valuesChanged callback for changed values with the signature (key, value)
 *       - vmName
 *       - os
 *       - version
 */
class CreateVM extends React.Component {
    constructor() {
        super();
        this.state = {
            //
        };
     }

     changeValue(key, e) {
         if (this.props.valuesChanged) {
             if (e && e.target && e.target.value)
                 this.props.valuesChanged(key, e.target.value);
         }
     }

     render() {
         return (
             <div className="modal-body">
                 <table className="form-table-ct">
                     <tr>
                         <td className="top">
                             <label className="control-label" for="vmname">
                                 {_("Name")}
                             </label>
                         </td>
                         <td>
                             <input id="vm-name" className="form-control" type="text"
                                    onChange={ this.changeValue.bind(this, 'vmName') } />
                         </td>
                     </tr>
                     <tr>
                         <td className="top">
                             <label className="control-label">
                                 {_("Operating System")}
                             </label>
                         </td>
                         <td>
                             <Select.Select>
                             </Select.Select>
                         </td>
                     </tr>
                     <tr>
                         <td className="top">
                             <label className="control-label">
                                 {_("Version")}
                             </label>
                         </td>
                         <td>
                             <Select.Select>
                             </Select.Select>
                         </td>
                     </tr>
                 </table>
             </div>
         );
     }
 }

 CreateVM.propTypes = {
     valuesChanged: PropTypes.func.isRequired,
     initialName: PropTypes.string.isRequired,
 };

 const createDialog = (dispatch) => {
     let vmParams = {
         'vmName': null,
         'osVariant': "centos7.0",
     };

     const changeParams = (key, value) => {
         vmParams[key] = value;
     };

     let dialogProps = {
         'title': _("Create New Virtual Machine"),
         'body': React.createElement(CreateVM, { 'initialName': vmParams['vmName'], 'valuesChanged': changeParams } ),
     };
     // also test modifying properties in subsequent render calls
     let footerProps = {
         'actions': [
               { 'clicked': () => { return dispatch(createVm(vmParams)); },
                 'caption': _("OK"),
                 'style': 'primary',
               },
           ],
     };
     let dialogObj = DialogPattern.show_modal_dialog(dialogProps, footerProps);
     // if this failed, exit (trying to create a nested dialog)
     if (!dialogObj)
         return;
 };

export default createDialog;
