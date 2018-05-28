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

'use strict';

const React = require('react');
const PropTypes = require("prop-types");

require('./listing.less');
// TODO remove next line and detail-page.less file as well once React 16 is merged
require('./detail-page.less');

const prefixedId = (idPrefix, id) => idPrefix ? `${idPrefix}-${id}` : null;

const DetailPage = ({children}) => {
    return (
        <div className="listing-ct-inline">
            {children}
        </div>
    );
};

const DetailPageRow = ({title, idPrefix, children}) => {
    // TODO use React.Fragment instead and remove 'className="detail-row"' once React 16 is merged
    return (
        <div className="detail-row">
            <h3 id={prefixedId(idPrefix, 'detail-row-title')}>{title}</h3>
            <div className="listing-ct-body container-fluid">
                {children}
            </div>
        </div>
    );
};

DetailPageRow.propTypes = {
    title: PropTypes.string,
    idPrefix: PropTypes.string, // row will have no elements with id if not specified
};

const DetailPageHeader = ({title, iconClass, navigateUpTitle, onNavigateUp, actions, idPrefix}) => {
    const icon = iconClass ? (<i className={iconClass} />) : null;
    const navigateUp = navigateUpTitle ? (
        <a id={prefixedId(idPrefix, 'link-up')} onClick={onNavigateUp}>
            {navigateUpTitle}
        </a>
    ) : null;

    return (
        <div className="content-filter">
            <div className="listing-ct-actions">
                {actions}
            </div>
            <h3>
                {icon}
                <span id={prefixedId(idPrefix, 'detail-header-title')}>{title}</span>
            </h3>
            {navigateUp}
        </div>
    );
};

DetailPageHeader.propTypes = {
    title: PropTypes.string,
    iconClass: PropTypes.string, // className used for an icon
    navigateUpTitle: PropTypes.string,
    onNavigateUp: PropTypes.func,
    actions: PropTypes.object,
    idPrefix: PropTypes.string, // header will have no elements with id if not specified
};

module.exports = {
    DetailPage,
    DetailPageHeader,
    DetailPageRow,
};
