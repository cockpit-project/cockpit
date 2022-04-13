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

import React, { useState, useEffect } from 'react';
import {
    ExpandableRowContent,
    TableComposable, Thead, Tbody, Tr, Th, Td,
    SortByDirection,
} from '@patternfly/react-table';
import {
    EmptyState, EmptyStateBody, EmptyStateSecondaryActions,
    Text, TextContent, TextVariants,
} from '@patternfly/react-core';

import './cockpit-components-table.scss';

/* This is a wrapper around PF Table component
 * See https://www.patternfly.org/v4/components/table/
 * Properties (all optional unless specified otherwise):
 * - caption
 * - id: optional identifier
 * - className: additional classes added to the Table
 * - actions: additional listing-wide actions (displayed next to the list's title)
 * - columns: { title: string, header: boolean, sortable: boolean }[] or string[]
 * - rows: {
 *      columns: (React.Node or string or { title: string, key: string, ...extraProps: object}}[]
                 Through extraProps the consumers can pass arbitrary properties to the <td>
 *      props: { key: string, ...extraProps: object }
               This property is mandatory and should contain a unique `key`, all additional properties are optional.
               Through extraProps the consumers can pass arbitrary properties to the <tr>
 *      expandedContent: (React.Node)[])
 *      initiallyExpanded : the entry will be initially rendered as expanded, but then behaves normally
 *   }[]
 * - emptyCaption: header caption to show if list is empty
 * - emptyCaptionDetail: extra details to show after emptyCaption if list is empty
 * - isEmptyStateInTable: if empty state is result of a filter function this should be set, otherwise false
 * - variant: For compact tables pass 'compact'
 * - gridBreakPoint: Specifies the grid breakpoints ('', 'grid' | 'grid-md' | 'grid-lg' | 'grid-xl' | 'grid-2xl')
 * - sortBy: { index: Number, direction: SortByDirection }
 * - style: object of additional css rules
 * - afterToggle: function to be called when content is toggled
 */
export const ListingTable = ({
    actions = [],
    afterToggle,
    caption = '',
    className,
    columns: cells = [],
    emptyCaption = '',
    emptyCaptionDetail,
    isEmptyStateInTable = false,
    onRowClick,
    onSelect,
    rows: tableRows = [],
    showHeader = true,
    sortBy,
    ...extraProps
}) => {
    let rows = tableRows;

    const [expanded, setExpanded] = useState({});
    const [newItems, setNewItems] = useState([]);
    const [currentRowsKeys, setCurrentRowsKeys] = useState([]);
    const [activeSortIndex, setActiveSortIndex] = useState(sortBy ? sortBy.index : 0);
    const [activeSortDirection, setActiveSortDirection] = useState(sortBy ? sortBy.direction : SortByDirection.asc);

    useEffect(() => {
        const getRowKeys = rows => {
            const keys = [];

            rows.forEach(row => {
                if (row.props && row.props.key)
                    keys.push(row.props.key);
            });

            return keys;
        };

        const current_keys = getRowKeys(rows);
        if (JSON.stringify(current_keys) === JSON.stringify(currentRowsKeys))
            return;

        // Don't highlight all when the list gets loaded
        if (currentRowsKeys.length !== 0) {
            const new_keys = current_keys.filter(key => currentRowsKeys.indexOf(key) === -1);
            if (new_keys.length)
                setNewItems([...newItems, ...new_keys]);
        }

        setCurrentRowsKeys(current_keys);
    }, [rows, currentRowsKeys, newItems]);

    const isSortable = cells.some(col => col.sortable);
    const isExpandable = rows.some(row => row.expandedContent);

    const tableProps = {};

    /* Basic table properties */
    tableProps.className = "ct-table";
    if (className)
        tableProps.className = tableProps.className + " " + className;
    if (rows.length == 0)
        tableProps.className += ' ct-table-empty';

    const header = (
        (caption || actions.length != 0)
            ? <header className='ct-table-header'>
                <h3 className='ct-table-heading'> {caption} </h3>
                {actions && <div className='ct-table-actions'> {actions} </div>}
            </header>
            : null
    );

    if (rows == 0) {
        const emptyState = (
            <EmptyState>
                <EmptyStateBody>
                    <div>{emptyCaption}</div>
                    <TextContent>
                        <Text component={TextVariants.small}>
                            {emptyCaptionDetail}
                        </Text>
                    </TextContent>
                </EmptyStateBody>
                {actions.length > 0 ? <EmptyStateSecondaryActions>{actions}</EmptyStateSecondaryActions> : null}
            </EmptyState>
        );
        if (!isEmptyStateInTable)
            return emptyState;

        const emptyStateCell = (
            [{
                props: { colSpan: cells.length },
                title: emptyState
            }]
        );

        rows = [{ columns: emptyStateCell }];
    }

    const sortRows = () => {
        const sortedRows = rows.sort((a, b) => {
            const aitem = a.columns[activeSortIndex];
            const bitem = b.columns[activeSortIndex];

            return ((typeof aitem == 'string' ? aitem : (aitem.sortKey || aitem.title)).localeCompare(typeof bitem == 'string' ? bitem : (bitem.sortKey || bitem.title)));
        });
        return activeSortDirection === SortByDirection.asc ? sortedRows : sortedRows.reverse();
    };

    const onSort = (event, index, direction) => {
        setActiveSortIndex(index);
        setActiveSortDirection(direction);
    };

    const rowsComponents = (isSortable ? sortRows() : rows).map((row, rowIndex) => {
        const rowProps = row.props || {};
        if (onRowClick) {
            rowProps.isHoverable = true;
            rowProps.onRowClick = (event) => onRowClick(event, row);
        }

        if (rowProps.key && newItems.indexOf(rowProps.key) >= 0)
            rowProps.className = (rowProps.className || "") + " ct-new-item";

        const rowKey = rowProps.key || rowIndex;
        const isExpanded = expanded[rowKey] === undefined ? !!row.initiallyExpanded : expanded[rowKey];
        const rowPair = (
            <React.Fragment key={rowKey + "-inner-row"}>
                <Tr {...rowProps}>
                    {isExpandable
                        ? (row.expandedContent
                            ? <Td expand={{
                                rowIndex: rowKey,
                                isExpanded,
                                onToggle: () => {
                                    if (afterToggle)
                                        afterToggle(!expanded[rowKey]);
                                    setExpanded({ ...expanded, [rowKey]: !expanded[rowKey] });
                                }
                            }} />
                            : <Td className="pf-c-table__toggle" />)
                        : null
                    }
                    {onSelect &&
                        <Td select={{
                            rowIndex,
                            onSelect,
                            isSelected: !!row.selected,
                        }} />
                    }
                    {row.columns.map((cell, cellIndex) => {
                        const { key, ...cellProps } = cell.props || {};
                        const dataLabel = typeof cells[cellIndex] == 'object' ? cells[cellIndex].title : cells[cellIndex];

                        if (cells[cellIndex] && cells[cellIndex].header)
                            return (
                                <Th key={key || `row_${rowKey}_cell_${dataLabel}`} dataLabel={dataLabel} {...cellProps}>
                                    {typeof cell == 'object' ? cell.title : cell}
                                </Th>
                            );

                        return (
                            <Td key={key || `row_${rowKey}_cell_${dataLabel}`} dataLabel={dataLabel} {...cellProps}>
                                {typeof cell == 'object' ? cell.title : cell}
                            </Td>
                        );
                    })}
                </Tr>
                {row.expandedContent && <Tr id={"expanded-content" + rowIndex} isExpanded={isExpanded}>
                    <Td noPadding={row.hasPadding !== true} colSpan={row.columns.length + 1 + (onSelect ? 1 : 0)}>
                        <ExpandableRowContent>{row.expandedContent}</ExpandableRowContent>
                    </Td>
                </Tr>}
            </React.Fragment>
        );

        if (row.expandedContent)
            return <Tbody key={rowKey} isExpanded={isExpanded}>{rowPair}</Tbody>;
        else
            return rowPair;
    });

    return (
        <>
            {header}
            <TableComposable {...extraProps} {...tableProps}>
                {showHeader && <Thead>
                    <Tr>
                        {isExpandable && <Th />}
                        {onSelect && <Th />}
                        {cells.map((column, columnIndex) => {
                            const columnProps = column.props;
                            const sortParams = (
                                column.sortable
                                    ? {
                                        sort: {
                                            sortBy: {
                                                index: activeSortIndex,
                                                direction: activeSortDirection
                                            },
                                            onSort,
                                            columnIndex
                                        }
                                    }
                                    : {}
                            );

                            return (
                                <Th key={columnIndex} {...columnProps} {...sortParams}>
                                    {typeof column == 'object' ? column.title : column}
                                </Th>
                            );
                        })}
                    </Tr>
                </Thead>}
                {!isExpandable ? <Tbody>{rowsComponents}</Tbody> : rowsComponents}
            </TableComposable>
        </>
    );
};
