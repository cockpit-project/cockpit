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

import PropTypes from 'prop-types';
import React from 'react';
import {
    Table,
    TableHeader,
    TableBody,
    headerCol,
    RowWrapper,
    SortByDirection,
    sortable,
} from '@patternfly/react-table';

import './cockpit-components-table.less';
import './listing.less';

/* This is a wrapper around PF Table component
 * See https://www.patternfly.org/v4/documentation/react/components/table
 * Properties (all optional unless specified otherwise):
 * - caption
 * - className: additional classes added to the Table
 * - actions: additional listing-wide actions (displayed next to the list's title)
 * - columns: { title: string, header: boolean, sortable: boolean }[] or string[]
 * - rows: {
 *      columns: (React.Node or string)[],
 *      extraClasses: string[],
 *      props: { key: string, ...extraProps: object } - this property is mandatory and should contain a unique `key`, all additional properties are optional
 *   }[]
 * - emptyCaption: header caption to show if list is empty
 * - variant: For compact tables pass 'compact'
 * - sortBy: { index: Number, direction: SortByDirection }
 */
export class ListingTable extends React.Component {
    constructor(props) {
        super(props);
        const sortBy = {};
        if ('sortBy' in props) {
            sortBy.index = props.sortBy.index || 0;
            sortBy.direction = props.sortBy.direction || SortByDirection.asc;
        }
        this.state = { sortBy };
        this.onSort = this.onSort.bind(this);
    }

    onSort(_event, index, direction) {
        this.setState({
            sortBy: {
                index,
                direction,
            },
        });
    }

    sortRows(rows) {
        const { index, direction } = this.state.sortBy;
        const sortedRows = rows.sort((a, b) => (a.cells[index].title.localeCompare(b.cells[index].title)));
        return direction === SortByDirection.asc ? sortedRows : sortedRows.reverse();
    }

    rowWrapper(...args) {
        const props = args[0];
        let className = '';

        if (props.row.extraClasses)
            className = props.row.extraClasses.join(' ');

        return <RowWrapper {...props} className={className} />;
    }

    reformatColumns(columns) {
        return columns.map(column => {
            const res = {};
            if (typeof column == 'string') {
                res.title = column;
            } else {
                res.title = column.title;
                if (column.header)
                    res.cellTransforms = [headerCol()];
                if (column.transforms)
                    res.transforms = column.transforms;
                if (column.sortable)
                    res.transforms = column.transforms ? [...column.transforms, sortable] : [sortable];
            }
            return res;
        });
    }

    reformatRows(rows) {
        return rows.reduce((total, currentValue, currentIndex) => {
            const rowFormatted = {
                cells: currentValue.columns.map((cell, cellIdx) => {
                    let res;
                    if (typeof cell == 'string')
                        res = { title: cell };
                    else
                        res = cell;

                    return res;
                }),
            };
            rowFormatted.extraClasses = currentValue.extraClasses;
            rowFormatted.props = currentValue.props;

            // For selectable rows
            if ('selected' in currentValue)
                rowFormatted.selected = currentValue.selected;

            total.push(rowFormatted);

            return total;
        }, []);
    }

    render() {
        const props = {};

        if (this.props.className)
            props.className = this.props.className;
        props.rowWrapper = this.rowWrapper;
        if (this.props.columns.some(col => col.sortable)) {
            props.onSort = this.onSort;
            props.sortBy = this.state.sortBy;
        }
        if (this.props.onSelect)
            props.onSelect = this.props.onSelect;
        if (this.props.caption || this.props.actions.length != 0) {
            props.header = (
                <header>
                    <h3 className='listing-ct-heading'> {this.props.caption} </h3>
                    {this.props.actions && <div className='listing-ct-actions'> {this.props.actions} </div>}
                </header>
            );
        }
        if (this.props.variant)
            props.variant = this.props.variant;
        props.rows = this.props.rows.length ? this.reformatRows(this.props.rows) : [];
        if (this.state.sortBy.index != undefined)
            props.rows = this.sortRows(props.rows);
        props.cells = this.reformatColumns(this.props.columns);
        if (this.props['aria-label'])
            props['aria-label'] = this.props['aria-label'];

        const tableBodyProps = { rowKey: ({ rowData, rowIndex }) => (rowData.props && rowData.props.key) ? rowData.props.key : rowIndex };
        if (this.props.onRowClick)
            tableBodyProps.onRowClick = this.props.onRowClick;
        if (this.props.rows.length > 0) {
            return (
                <Table {...props}>
                    <TableHeader />
                    <TableBody {...tableBodyProps} />
                </Table>
            );
        } else {
            props.borders = false;
            return (
                <Table {...props}>
                    <thead className='listing-ct-empty'>
                        <tr><td> {this.props.emptyCaption} </td></tr>
                    </thead>
                </Table>
            );
        }
    }
}
ListingTable.defaultProps = {
    caption: '',
    emptyCaption: '',
    columns: [],
    rows: [],
    actions: [],
};
ListingTable.propTypes = {
    caption: PropTypes.string,
    emptyCaption: PropTypes.node,
    columns: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.object, PropTypes.string])),
    rows: PropTypes.arrayOf(PropTypes.shape({ props: PropTypes.object.isRequired })),
    actions: PropTypes.node,
    variant: PropTypes.string,
};
