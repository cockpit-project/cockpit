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
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import InfoRecord from './infoRecord.jsx';

const _ = cockpit.gettext;

const DiskSourceCell = ({ diskSource, idPrefix }) => {
    const addOptional = (chunks, value, descr) => {
        if (value) {
            chunks.push(<InfoRecord descrClass='machines-disks-source-descr' descr={descr}
                                    valueClass='machines-disks-source-value' value={value}
                                    key={descr} />);
        }
    };

    const chunks = [];
    addOptional(chunks, diskSource.file, _("File"));
    addOptional(chunks, diskSource.dev, _("Device"));
    addOptional(chunks, diskSource.protocol, _("Protocol"));
    addOptional(chunks, diskSource.pool, _("Pool"));
    addOptional(chunks, diskSource.volume, _("Volume"));
    addOptional(chunks, diskSource.host.name, _("Host"));
    addOptional(chunks, diskSource.host.port, _("Port"));

    return (
        <table className='machines-disks-source' id={`${idPrefix}-source`}>
            <tbody>
                {chunks}
            </tbody>
        </table>
    );
};

DiskSourceCell.propTypes = {
    diskSource: PropTypes.object.isRequired,
    idPrefix: PropTypes.string.isRequired,
};

export default DiskSourceCell;
