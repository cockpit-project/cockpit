/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

import React from 'react';
import PropTypes from 'prop-types';
import { Button, Modal } from '@patternfly/react-core';

import cockpit from 'cockpit';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { revertSnapshot } from '../libvirt-dbus.js';

const _ = cockpit.gettext;

export class RevertSnapshotModal extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            dialogError: undefined,
            inProgress: false,
        };

        this.revert = this.revert.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    revert() {
        this.setState({ inProgress: true });
        const { vm, snap } = this.props;

        revertSnapshot({ connectionName: vm.connectionName, domainPath: vm.id, snapshotName: snap.name })
                .then(this.props.onClose, exc => {
                    this.setState({ inProgress: false });
                    this.dialogErrorSet(_("Could not revert to snapshot"), exc.message);
                });
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    render() {
        const { idPrefix, snap, onClose } = this.props;

        return (
            <Modal position="top" variant="medium" id={`${idPrefix}-snapshot-${snap.name}-modal`} isOpen onClose={onClose}
                   title={cockpit.format(_("Revert to snapshot $0"), snap.name)}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button variant='primary' isLoading={this.state.inProgress} isDisabled={this.state.inProgress} onClick={this.revert}>
                               {_("Revert")}
                           </Button>
                           <Button variant='link' className='btn-cancel' onClick={onClose}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                <>
                    { cockpit.format(_("Reverting to this snapshot will take the VM back to the time of the snapshot and the current state will be lost, along with any data not captured in a snapshot")) }
                </>
            </Modal>
        );
    }
}

RevertSnapshotModal.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    vm: PropTypes.object.isRequired,
    snap: PropTypes.object.isRequired,
    onClose: PropTypes.func.isRequired,
};
