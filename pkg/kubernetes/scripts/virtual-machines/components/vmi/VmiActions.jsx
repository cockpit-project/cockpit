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

// @flow

import React, { PropTypes } from 'react';
import { gettext as _ } from 'cockpit';
import { connect } from 'react-redux';

import DropdownButtons from '../../../../../machines/components/dropdownButtons.jsx';

import type { Vmi } from '../../types.es6';
import { kindIdPrefx, prefixedId } from '../../utils.es6';
import { createFailHandler } from '../util/utils.jsx';
import { remove } from '../../kube-middleware.es6';
import { vmiActionFailed } from '../../action-creators.es6';

const Delete = ({vmi, onDeleteSuccess, onDeleteFailure, idPrefix, disabled}) => {
    const onDelete = () => remove(vmi).then(onDeleteSuccess)
            .catch((createFailHandler(onDeleteFailure, _("delete"), _("VMI"))));

    return {
        title: _("Delete"),
        action: onDelete,
        id: prefixedId(idPrefix, 'delete'),
        disabled,
    };
};

const VmiActions = ({vmi, onDeleteSuccess, onDeleteFailure}: { vmi: Vmi, onDeleteSuccess: Function, onDeleteFailure: Function }) => {
    const idPrefix = kindIdPrefx(vmi);

    let dropdownButtons = [
        Delete({
            vmi,
            onDeleteSuccess,
            onDeleteFailure,
            idPrefix
        })
    ];

    return (
        <DropdownButtons buttons={dropdownButtons} />
    );
};

VmiActions.propTypes = {
    vmi: PropTypes.object.isRequired,
    onDeleteSuccess: PropTypes.func.isRequired,
    onDeleteFailure: PropTypes.func.isRequired,
};

export default connect(
    () => ({}),
    (dispatch, {vmi}) => ({
        onDeleteFailure: ({message, detail}) => dispatch(vmiActionFailed({
            vmi,
            message,
            detail
        })),
    }),
)(VmiActions);
