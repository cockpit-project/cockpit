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
import React from 'react';
import PropTypes from 'prop-types';
import { DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription } from '@patternfly/react-core';

import { storagePoolId } from '../../helpers.js';
import cockpit from 'cockpit';

import 'form-layout.scss';

const _ = cockpit.gettext;

export const StoragePoolOverviewTab = ({ storagePool }) => {
    const idPrefix = `${storagePoolId(storagePool.name, storagePool.connectionName)}`;

    return (
        <DescriptionList isHorizontal>
            { storagePool.source && storagePool.source.host && <DescriptionListGroup>
                <DescriptionListTerm> {_("Host")} </DescriptionListTerm>
                <DescriptionListDescription id={`${idPrefix}-host`}>
                    {storagePool.source.host.name}
                </DescriptionListDescription>
            </DescriptionListGroup> }

            { storagePool.source && storagePool.source.device && <DescriptionListGroup>
                <DescriptionListTerm> {_("Source path")} </DescriptionListTerm>
                <DescriptionListDescription id={`${idPrefix}-source-path`}> {storagePool.source.device.path} </DescriptionListDescription>
            </DescriptionListGroup> }

            { storagePool.source && storagePool.source.dir && <DescriptionListGroup>
                <DescriptionListTerm> {_("Source path")} </DescriptionListTerm>
                <DescriptionListDescription id={`${idPrefix}-source-path`}> {storagePool.source.dir.path} </DescriptionListDescription>
            </DescriptionListGroup> }

            { storagePool.source && storagePool.source.name && <DescriptionListGroup>
                <DescriptionListTerm> {_("Source")} </DescriptionListTerm>
                <DescriptionListDescription id={`${idPrefix}-source-path`}> {storagePool.source.name} </DescriptionListDescription>
            </DescriptionListGroup> }

            { storagePool.source && storagePool.source.format && <DescriptionListGroup>
                <DescriptionListTerm> {_("Source format")} </DescriptionListTerm>
                <DescriptionListDescription id={`${idPrefix}-source-format`}> {storagePool.source.format.type} </DescriptionListDescription>
            </DescriptionListGroup> }

            { storagePool.target && storagePool.target.path && <DescriptionListGroup>
                <DescriptionListTerm> {_("Target path")} </DescriptionListTerm>
                <DescriptionListDescription id={`${idPrefix}-target-path`}> {storagePool.target.path} </DescriptionListDescription>
            </DescriptionListGroup> }

            <DescriptionListGroup>
                <DescriptionListTerm> {_("Persistent")} </DescriptionListTerm>
                <DescriptionListDescription id={`${idPrefix}-persistent`}> {storagePool.persistent ? _("yes") : _("no")} </DescriptionListDescription>
            </DescriptionListGroup>

            {storagePool.persistent && <DescriptionListGroup>
                <DescriptionListTerm> {_("Autostart")} </DescriptionListTerm>
                <DescriptionListDescription id={`${idPrefix}-autostart`}> {storagePool.autostart ? _("yes") : _("no")} </DescriptionListDescription>
            </DescriptionListGroup>}

            <DescriptionListGroup>
                <DescriptionListTerm> {_("Type")} </DescriptionListTerm>
                <DescriptionListDescription id={`${idPrefix}-type`}> {storagePool.type} </DescriptionListDescription>
            </DescriptionListGroup>
        </DescriptionList>
    );
};
StoragePoolOverviewTab.propTypes = {
    storagePool: PropTypes.object.isRequired,
};
