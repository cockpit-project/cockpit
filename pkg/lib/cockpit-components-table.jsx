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
    expandable,
} from '@patternfly/react-table';

import './cockpit-components-table.scss';

/* This is a wrapper around PF Table component
 * See https://www.patternfly.org/v4/components/table
 * Properties (all optional unless specified otherwise):
 * - caption
 * - className: additional classes added to the Table
 * - actions: additional listing-wide actions (displayed next to the list's title)
 * - columns: { title: string, header: boolean, sortable: boolean }[] or string[]
 * - rows: {
 *      columns: (React.Node or string)[],
 *      extraClasses: string[],
 *      props: { key: string, ...extraProps: object } - this property is mandatory and should contain a unique `key`, all additional properties are optional
 *      expandedContent: (React.Node)[])
 *      initiallyExpanded : the entry will be initially rendered as expanded, but then behaves normally
 *      rowId: an identifier for the row which will be set as "data-row-id" and attribute on the <tr>
 *   }[]
 * - emptyCaption: header caption to show if list is empty
 * - variant: For compact tables pass 'compact'
 * - gridBreakPoint: Specifies the grid breakpoints ('grid' | 'grid-md' | 'grid-lg' | 'grid-xl' | 'grid-2xl')
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
        this.onSort = this.onSort.bind(this);
        this.onCollapse = this.onCollapse.bind(this);
        this.reformatRows = this.reformatRows.bind(this);

        this.state = { sortBy, isOpen: {} };
    }

    static getDerivedStateFromProps(nextProps, prevState) {
        const isOpen = {};
        (nextProps.rows || []).forEach(currentValue => {
            // For expandable rows
            if (currentValue.expandedContent) {
                if (prevState.isOpen[currentValue.props.key] === undefined)
                    isOpen[currentValue.props.key] = !!currentValue.initiallyExpanded;
                else
                    isOpen[currentValue.props.key] = prevState.isOpen[currentValue.props.key];
            }
        });
        return { isOpen };
    }

    onSort(_event, index, direction) {
        this.setState({
            sortBy: {
                index,
                direction,
            },
        });
    }

    onCollapse(event, rowKey, isOpenCurrent, rowData) {
        const { isOpen } = this.state;

        isOpen[rowData.props.key] = isOpenCurrent;
        this.setState({ isOpen });
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

        return <RowWrapper {...props} {...props.row.props} data-row-id={props.row.rowId} className={className} />;
    }

    reformatColumns(columns, isExpandable) {
        const res = columns.map(column => {
            const res = {};
            if (typeof column == 'string') {
                res.title = column;
            } else {
                res.title = column.title;
                res.cellTransforms = [];
                if (column.header)
                    res.cellTransforms.push(headerCol());
                if (column.cellTransforms)
                    res.cellTransforms = res.cellTransforms.concat(column.cellTransforms);
                if (column.transforms)
                    res.transforms = column.transforms;
                if (column.sortable)
                    res.transforms = column.transforms ? [...column.transforms, sortable] : [sortable];
            }
            return res;
        });

        if (isExpandable)
            res[0].cellFormatters = [expandable];

        return res;
    }

    reformatRows(rows) {
        let rowIndex = 0;
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
            rowFormatted.rowId = currentValue.rowId;

            // For selectable rows
            if ('selected' in currentValue)
                rowFormatted.selected = currentValue.selected;

            // For expandable rows
            if (currentValue.expandedContent)
                rowFormatted.isOpen = this.state.isOpen[currentValue.props.key];

            total.push(rowFormatted);
            rowIndex++;

            if (currentValue.expandedContent) {
                total.push({
                    parent: rowIndex - 1,
                    cells: [{ title: currentValue.expandedContent }],
                    fullWidth: true, noPadding: !currentValue.hasPadding,
                    rowId: currentValue.rowId ? (currentValue.rowId + "-expanded") : undefined,
                    props: { key: currentValue.props.key + "-expanded" },
                });
                rowIndex++;
            }

            return total;
        }, []);
    }

    render() {
        const tableProps = {};

        if (this.props.gridBreakPoint)
            tableProps.gridBreakPoint = this.props.gridBreakPoint;
        tableProps.className = "ct-table";
        if (this.props.className)
            tableProps.className = tableProps.className + " " + this.props.className;
        tableProps.rowWrapper = this.rowWrapper;
        if (this.props.columns.some(col => col.sortable)) {
            tableProps.onSort = this.onSort;
            tableProps.sortBy = this.state.sortBy;
        }
        if (this.props.onSelect)
            tableProps.onSelect = this.props.onSelect;
        if (this.props.caption || this.props.actions.length != 0) {
            tableProps.header = (
                <header className='ct-table-header'>
                    <h3 className='ct-table-heading'> {this.props.caption} </h3>
                    {this.props.actions && <div className='ct-table-actions'> {this.props.actions} </div>}
                </header>
            );
        }
        if (this.props.variant)
            tableProps.variant = this.props.variant;

        const isExpandable = this.props.rows.some(row => row.expandedContent);
        if (isExpandable)
            tableProps.onCollapse = this.onCollapse;

        tableProps.rows = this.props.rows.length ? this.reformatRows(this.props.rows) : [];
        if (this.state.sortBy.index != undefined)
            tableProps.rows = this.sortRows(tableProps.rows);
        tableProps.cells = this.reformatColumns(this.props.columns, isExpandable);
        if (this.props['aria-label'])
            tableProps['aria-label'] = this.props['aria-label'];

        const tableBodyProps = { rowKey: ({ rowData, rowIndex }) => (rowData.props && rowData.props.key) ? rowData.props.key : rowIndex };
        if (this.props.onRowClick)
            tableBodyProps.onRowClick = this.props.onRowClick;
        if (this.props.rows.length > 0) {
            return (
                <Table {...tableProps}>
                    {this.props.showHeader && <TableHeader />}
                    <TableBody {...tableBodyProps} />
                </Table>
            );
        } else {
            tableProps.borders = false;
            return (
                <Table {...tableProps}>
                    <thead className='ct-table-empty'>
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
    showHeader: true,
};
ListingTable.propTypes = {
    caption: PropTypes.string,
    emptyCaption: PropTypes.node,
    columns: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.object, PropTypes.string])),
    rows: PropTypes.arrayOf(PropTypes.shape({ props: PropTypes.object })),
    actions: PropTypes.node,
    variant: PropTypes.string,
    showHeader: PropTypes.bool,
};
