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
    Table, Thead, Tbody, Tr, Th, Td,
    SortByDirection,
} from '@patternfly/react-table';
import { EmptyState, EmptyStateBody, EmptyStateFooter, EmptyStateActions } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Text, TextContent, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";

import './cockpit-components-table.scss';

/* This is a wrapper around PF Table component
 * See https://www.patternfly.org/components/table/
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
 *      selected: boolean option if the row is selected
 *      initiallyExpanded : the entry will be initially rendered as expanded, but then behaves normally
 *   }[]
 * - emptyCaption: header caption to show if list is empty
 * - emptyCaptionDetail: extra details to show after emptyCaption if list is empty
 * - emptyComponent: Whole empty state component to show if the list is empty
 * - isEmptyStateInTable: if empty state is result of a filter function this should be set, otherwise false
 * - loading: Set to string when the content is still loading. This string is shown.
 * - variant: For compact tables pass 'compact'
 * - gridBreakPoint: Specifies the grid breakpoints ('', 'grid' | 'grid-md' | 'grid-lg' | 'grid-xl' | 'grid-2xl')
 * - sortBy: { index: Number, direction: SortByDirection }
 * - sortMethod: callback function used for sorting rows. Called with 3 parameters: sortMethod(rows, activeSortDirection, activeSortIndex)
 * - style: object of additional css rules
 * - afterToggle: function to be called when content is toggled
 * - onSelect: function to be called when a checkbox is clicked. Called with 5 parameters:
 *   event, isSelected, rowIndex, rowData, extraData. rowData contains props with an id property of the clicked row.
 * - onHeaderSelect: event, isSelected.
 */
export const ListingTable = ({
    actions = [],
    afterToggle,
    caption = '',
    className,
    columns: cells = [],
    emptyCaption = '',
    emptyCaptionDetail,
    emptyComponent,
    isEmptyStateInTable = false,
    loading = '',
    onRowClick,
    onSelect,
    onHeaderSelect,
    rows: tableRows = [],
    showHeader = true,
    sortBy,
    sortMethod,
    ...extraProps
}) => {
    let rows = [...tableRows];
    const [expanded, setExpanded] = useState({});
    const [newItems, setNewItems] = useState([]);
    const [currentRowsKeys, setCurrentRowsKeys] = useState([]);
    const [activeSortIndex, setActiveSortIndex] = useState(sortBy?.index ?? 0);
    const [activeSortDirection, setActiveSortDirection] = useState(sortBy?.direction ?? SortByDirection.asc);
    const rowKeys = rows.map(row => row.props?.key)
            .filter(key => key !== undefined);
    const rowKeysStr = JSON.stringify(rowKeys);
    const currentRowsKeysStr = JSON.stringify(currentRowsKeys);

    useEffect(() => {
        // Don't highlight all when the list gets loaded
        const _currentRowsKeys = JSON.parse(currentRowsKeysStr);
        const _rowKeys = JSON.parse(rowKeysStr);

        if (_currentRowsKeys.length !== 0) {
            const new_keys = _rowKeys.filter(key => _currentRowsKeys.indexOf(key) === -1);
            if (new_keys.length) {
                setTimeout(() => setNewItems(items => items.filter(item => new_keys.indexOf(item) < 0)), 4000);
                setNewItems(ni => [...ni, ...new_keys]);
            }
        }

        setCurrentRowsKeys(crk => [...new Set([...crk, ..._rowKeys])]);
    }, [currentRowsKeysStr, rowKeysStr]);

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

    if (loading)
        return <EmptyState>
            <EmptyStateBody>
                {loading}
            </EmptyStateBody>
        </EmptyState>;

    if (rows == 0) {
        let emptyState = null;
        if (emptyComponent)
            emptyState = emptyComponent;
        else
            emptyState = (
                <EmptyState>
                    <EmptyStateBody>
                        <div>{emptyCaption}</div>
                        <TextContent>
                            <Text component={TextVariants.small}>
                                {emptyCaptionDetail}
                            </Text>
                        </TextContent>
                    </EmptyStateBody>
                    {actions.length > 0 &&
                    <EmptyStateFooter>
                        <EmptyStateActions>{actions}</EmptyStateActions>
                    </EmptyStateFooter>}
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

    const rowsComponents = (isSortable ? (sortMethod ? sortMethod(rows, activeSortDirection, activeSortIndex) : sortRows()) : rows).map((row, rowIndex) => {
        const rowProps = row.props || {};
        if (onRowClick) {
            rowProps.isClickable = true;
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
                            : <Td className="pf-v5-c-table__toggle" />)
                        : null
                    }
                    {onSelect &&
                        <Td select={{
                            rowIndex,
                            onSelect,
                            isSelected: !!row.selected,
                            props: {
                                id: rowKey
                            }
                        }} />
                    }
                    {row.columns.map((cell, cellIndex) => {
                        const { key, ...cellProps } = cell.props || {};
                        const dataLabel = typeof cells[cellIndex] == 'object' ? cells[cellIndex].title : cells[cellIndex];
                        const colKey = dataLabel || cellIndex;
                        if (cells[cellIndex]?.header)
                            return (
                                <Th key={key || `row_${rowKey}_cell_${colKey}`} dataLabel={dataLabel} {...cellProps}>
                                    {typeof cell == 'object' ? cell.title : cell}
                                </Th>
                            );

                        return (
                            <Td key={key || `row_${rowKey}_cell_${colKey}`} dataLabel={dataLabel} {...cellProps}>
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

        return <Tbody key={rowKey} isExpanded={row.expandedContent && isExpanded}>{rowPair}</Tbody>;
    });

    return (
        <>
            {header}
            <Table {...extraProps} {...tableProps}>
                {showHeader && <Thead>
                    <Tr>
                        {isExpandable && <Th />}
                        {!onHeaderSelect && onSelect && <Th />}
                        {onHeaderSelect && onSelect && <Th select={{
                            onSelect: onHeaderSelect,
                            isSelected: rows.every(r => r.selected)
                        }} />}
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
                {rowsComponents}
            </Table>
        </>
    );
};
