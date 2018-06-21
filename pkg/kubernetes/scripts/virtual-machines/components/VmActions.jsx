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

import type { Vm } from '../types.jsx';
import { vmIdPrefx, mouseClick } from '../utils.jsx';
import { vmDelete } from '../kube-middleware.jsx';
import { vmActionFailed } from '../action-creators.jsx';

// import DropdownButtons from '../../../../machines/components/dropdownButtons.jsx';

const VmActions = ({ vm, onDeleteSuccess, onDeleteFailure }: { vm: Vm, onDeleteSuccess: Function, onDeleteFailure: Function }) => {
    const id = vmIdPrefx(vm);

    const onDelete = () => {
        vmDelete({ vm }).then(onDeleteSuccess)
                .catch((error) => {
                    console.info('VmActions: delete failed: ', error);
                    onDeleteFailure({
                        message: _("VM DELETE failed."),
                        detail: error,
                    });
                });
    };

    const buttonDelete = (
        <button className="btn btn-default btn-danger" onClick={mouseClick(onDelete)} id={`${id}-delete`}>
            {_("Delete")}
        </button>);

    return (
        <div>
            {buttonDelete}
        </div>);
};

VmActions.propTypes = {
    vm: PropTypes.object.isRequired,
    onDeleteSuccess: PropTypes.func.isRequired,
    onDeleteFailure: PropTypes.func.isRequired,
};

export default connect(
    () => ({}),
    (dispatch, { vm }) => ({
        onDeleteFailure: ({ message, detail }) => dispatch(vmActionFailed({ vm, message, detail })),
    }),
)(VmActions);
