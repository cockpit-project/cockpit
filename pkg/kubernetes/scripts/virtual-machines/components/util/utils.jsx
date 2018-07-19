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

// @flow
import React from 'react';

import cockpit, { gettext as _ } from 'cockpit';

import { getPairs } from '../../utils.es6';
import { EMPTY_LABEL } from '../../constants.es6';
import type { Vm, Vmi } from '../../types.es6';

export const getLabels = (vmi: Vm | Vmi) => {
    let labels = null;
    if (vmi.metadata.labels) {
        labels = getPairs(vmi.metadata.labels).map(pair => {
            const printablePair = `${pair.key}=${pair.value}`;
            return (<div key={printablePair}>{printablePair}</div>);
        });
    }
    return labels || (<div>{EMPTY_LABEL}</div>);
};

export const createFailHandler = (onFailure, action, type) => {
    return (error) => {
        console.info(`${type} action: ${action} failed: `, error);

        onFailure({
            message: cockpit.format(_("$0 $1 failed."), type, action.toUpperCase()),
            detail: error,
        });
    };
};
