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
import { show_modal_dialog } from 'cockpit-components-dialog.jsx';
import { deleteVm } from '../actions/provider-actions.es6';

import './deleteDialog.css';

const _ = cockpit.gettext;

const DeleteDialogBody = ({ values, onChange }) => {
    function disk_row(disk) {
        return (
            <tr key={disk.target}>
                <td>
                    <input type="checkbox" checked={disk.checked}
                           onChange={(event) => {
                               disk.checked = event.target.checked;
                               onChange();
                           }} />
                </td>
                <td>{disk.file}</td>
                <td>{disk.target}</td>
            </tr>
        );
    }

    let alert = null;
    if (values.destroy)
        alert = <p>{_("The VM is running and will be forced off before deletion.")}</p>;

    let disks = null;
    if (values.disks.length > 0)
        disks = (
            <div>
                <p>{_("Delete associated storage files:")}</p>
                <table className="table delete-dialog-disks">
                    <tbody>
                        { values.disks.map(disk_row) }
                    </tbody>
                </table>
            </div>
        );

    return (
        <div className="modal-body">
            {alert}
            {disks}
        </div>
    );
};

export function deleteDialog(vm, dispatch) {
    let values = {
        destroy: false,
        disks: [ ]
    };

    Object.keys(vm.disks).sort()
            .forEach(t => {
                let d = vm.disks[t];
                if (d.type == 'file' && d.source.file)
                    values.disks.push({ target: d.target, file: d.source.file, checked: !d.readonly });
            });

    if (vm.state == 'running')
        values.destroy = true;

    function body_props() {
        return {
            title: cockpit.format(_("Confirm deletion of $0"), vm.name),
            body: <DeleteDialogBody values={values} onChange={() => dlg.setProps(body_props())} />
        };
    }

    let dlg = show_modal_dialog(
        body_props(),
        { actions: [
            { caption: _("Delete"),
              style: 'danger',
              clicked: () => {
                  let storage = [ ];
                  values.disks.forEach(d => { if (d.checked) storage.push(d.file); });
                  return dispatch(deleteVm(vm, { destroy: values.destroy, storage: storage }));
              }
            }
        ]
        });
}
