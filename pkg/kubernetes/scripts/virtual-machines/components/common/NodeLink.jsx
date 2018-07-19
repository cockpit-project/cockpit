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

import React, { PropTypes } from 'react';
import { EMPTY_LABEL } from '../../constants.es6';

const NodeLink = ({name}) => {
    return name ? (<a href={`#/nodes/${name}`}>{name}</a>) : (<div>{EMPTY_LABEL}</div>);
};

NodeLink.propTypes = {
    name: PropTypes.string.isRequired,
};

export default NodeLink;
