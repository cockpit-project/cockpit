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

import React from 'react';
import PropTypes from 'prop-types';
import {
    Button,
    OverlayTrigger,
    Tooltip,
} from 'patternfly-react';

import { storageVolumeDelete, storagePoolRefresh } from '../../libvirt-dbus.js';
import cockpit from 'cockpit';

import './storageVolumeDelete.css';

const _ = cockpit.gettext;

export class StorageVolumeDelete extends React.Component {
    constructor(props) {
        super(props);
        this.storageVolumeListDelete = this.storageVolumeListDelete.bind(this);
    }

    storageVolumeListDelete() {
        const { volumes, storagePool, resetSelection } = this.props;

        Promise.all(volumes.map(volume =>
            storageVolumeDelete(storagePool.connectionName, storagePool.name, volume)
        ))
                .catch(exc => {
                    this.props.deleteErrorHandler(_("Storage Volumes could not be deleted"), exc.message);
                })
                .then(() => {
                    storagePoolRefresh(storagePool.connectionName, storagePool.id);
                    resetSelection();
                });
    }

    render() {
        const { volumes, isVolumeUsed } = this.props;
        const volCount = volumes.length;
        const anyVolumeUsed = volumes.some(volume => isVolumeUsed[volume].length != 0);

        if (volCount == 0)
            return null;

        const deleteBtn = (
            <Button className='storage-volumes-actions' id='storage-volumes-delete'
                    bsStyle='danger' onClick={this.storageVolumeListDelete}
                    disabled={ anyVolumeUsed }>
                {cockpit.format(cockpit.ngettext("Delete $0 volume", 'Delete $0 volumes', volCount), volCount)}
            </Button>
        );

        if (!anyVolumeUsed)
            return deleteBtn;

        return (
            <OverlayTrigger placement='top'
                            overlay={<Tooltip id='volume-delete-tooltip'>{ anyVolumeUsed ? _("One or more selected volumes are used by domains. Detach the disks first to allow volume deletion.") : "" }</Tooltip>}>
                { deleteBtn }
            </OverlayTrigger>
        );
    }
}
StorageVolumeDelete.propTypes = {
    storagePool: PropTypes.object.isRequired,
    volumes: PropTypes.array.isRequired,
    isVolumeUsed: PropTypes.object.isRequired,
    resetSelection: PropTypes.func.isRequired,
    deleteErrorHandler: PropTypes.func.isRequired,
};
