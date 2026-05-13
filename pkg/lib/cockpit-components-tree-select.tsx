/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState, useRef, useEffect } from 'react';

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { ToggleGroup, ToggleGroupItem } from '@patternfly/react-core/dist/esm/components/ToggleGroup/index.js';
import { Button, ButtonProps } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { Table, Caption, Tbody, Tr, Td } from '@patternfly/react-table';
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";

const _ = cockpit.gettext;

/* TreeSelectButton - a mostly general purpose widget for selecting
                      something from a tree of choices.

   The main application is for a file chooser, and that might show.

   The tree is constructed dynamically and asynchronously while the
   user browses it. There are lists of shortcuts (such as "Recent"),
   prepared filters (such as "all ISO files"), and free text
   filtering. This widget is supposed to be pleasant to use with only
   the keyboard.

   When instantiating a TreeSelectButton, you get a button that will
   open a biggish modal dialog that runs the actual selection user
   interaction.  You can place the button into a modal dialog itself
   and it will all work.

   The tree is made up of nodes.  Each node has a name and maybe an
   array of children.  The current position in the tree is stored as a
   "path" of nodes, which is an array of nodes.  The TreeSelect modal
   shows the child nodes of the last node of that array and the user
   can click on them.  (Or navigate with the keyboard to one and hit
   Enter.)  What happens then is up to attributes of the node.
   Sometimes it gets highlighted and the dialog can be closed with
   this node as the selection. Sometimes the dialog adds the node to
   the end of the path and navigates to the new location. Sometimes
   both. Some nodes are links and clicking on them will replace the
   path an arbitrary new one.

   A TreeSelect can have multiple roots and the user can select which
   one to browse via corresponding toggle buttons in the dropdown
   footer. (If there is only one root, the lone toggle button for it
   is not shown.)

   The details are best documented by explaining the types and
   properties of TreeSelect. First the types:

   - TreeNode<N>

     This is the basic type of the items that the user browses and
     selects.  You can extend it and add your own fields, and the
     children need to also be the extended type; that's why TreeNode
     is generic.

     A TreeNode has a "name" (string) which is displayed in the list,
     and a array of TreeNode<N> children in the "children" field.
     When "children" is undefined, the "listChildren" function is used
     to compute them, see below.  When "children" is false, this node
     is a leaf and will never be part of the path.

     A node can also have a "link" field, which is also an array of
     TreeNode<N>.  When such a node is selected, the link becomes the
     new browsing location. (Thus, this is always an absolute link.)
     Links are used for shortcuts.

     [ Right now, a node has isSelectable and isLeaf booleans as
       ad-hoc measures to experiment with the precise user
       interactions.  This might change.
     ]

   - TreeRoot<N>

     A TreeRoot is a "label" (string) plus a "root" (TreeNode<N>).

     The roots are shown in a sidebar.  Typical examples are the
     "Recent" list and shortcuts to important places in the
     filesystem.

   - TreeFilter<N>

     A "label" (string) plus a function "filter".  The label is shown
     in a toggle button in the footer of the dropdown, and when it is
     selected by the user, the "filter" function is called for each of
     the nodes in the list and only the ones where it returns true are
     shown.

   TreeSelect properties:

   - title: string

     The title for the modal dialog.

   - roots: TreeRoot[]

     This is the array of TreeRoot objects used for the side bar.

   - formatHeader: (node: TreeNode) => ReactNode

     This function is called to render a node for the breadcrumb trail
     that shows the current browsing location.

   - formatExtraColumns: (node: TreeNode) => ReactNode[]

     When a node appears in the big list of children, this function is
     called to compute additional columns for it.  The first column is
     always the name.

   - listChildren: (path: TreeNode[]) => Promise<TreeNode[]>

     This function will be called to compute the children of the last
     node in "path".  The whole path is passed since all nodes in the
     path are normally important.  When the nodes are files in the
     filesystem, then each element of "path" represents a directory.

     It's ok to throw an error in this function. It will be caught and
     rendered nicely.

   - onSelect: (path: TreeNode[]) => boolean

     This function is called when the user confirms the selection with
     the apply button in the dialog.

   - plus all Button props.
 */

/*
   TODO

   [ ] Change "path" to always include the selected item
   [ ] Avoid jitter when adding/removing focus border
   [ ] Scroll focused elements into view
   [ ] Polish, use PF variables for styling, etc.
 */

export interface TreeNode<N extends TreeNode<N>> {
    name: string;
    link?: undefined | N[];
    isSelectable: boolean;
    isLeaf: boolean,
}

export interface TreeFilter<N> {
    label: string;
    filter: (node: N) => boolean;
}

export interface TreeRoot<N> {
    label: string;
    root: N;
}

interface TreeChildren<N> {
    nodes: N[] | null;
    error: string | null;
}

export function TreeSelectButton<Node extends TreeNode<Node>>({
    title,
    roots,
    filters,
    formatHeader,
    formatExtraColumns,
    formatSelected,
    listChildren,
    initialPath = null,
    onSelect,
    selectTitle,
    ...buttonProps
} : {
    title: string,
    roots: TreeRoot<Node>[],
    filters?: TreeFilter<Node>[],
    formatHeader: (node: Node) => React.ReactNode,
    formatExtraColumns: (node: Node) => React.ReactNode[]
    formatSelected?: undefined | ((path: Node[]) => Promise<React.ReactNode>),
    listChildren: (path: Node[]) => Promise<Node[]>,
    initialPath?: null | Node[],
    onSelect: (path: Node[]) => Promise<void>,
    selectTitle: string,
} & Omit<ButtonProps, 'onSelect'>) {
    const [isOpen, _setIsOpen] = useState(false);
    const [path, _setPath] = useState<Node[]>([]);
    const [children, setChildren] = useState<TreeChildren<Node>>({ nodes: null, error: null });
    const [filter, setFilter] = useState<TreeFilter<Node> | null>(null);
    const [textInput, setTextInput] = useState<string>("");
    const [focusIndex, setFocusIndex] = useState<number>(-1);
    const [selected, setSelected] = useState<Node | null>(null);
    const [inProgress, setInProgress] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [formattedSelected, setFormattedSelected] = useState<React.ReactNode>(null);

    const textInputRef = useRef<HTMLInputElement>(null);

    const filterText = textInput;

    function setIsOpen(isOpen: boolean) {
        _setIsOpen(isOpen);
        if (isOpen) {
            if (initialPath && initialPath.length > 0) {
                if (initialPath[initialPath.length - 1].isLeaf) {
                    setPath(initialPath.slice(0, path.length - 2));
                } else
                    setPath(initialPath);
            } else
                setRoot(roots[0]);
            setFilter(filters ? filters[0] : null);
            setSelected(null);
            setFormattedSelected(null);
        }
    }

    useEffect(() => {
        if (isOpen)
            textInputRef.current?.focus();
    }, [isOpen]);

    function setRoot(r: TreeRoot<Node>) {
        setPath(followLinks([r.root]));
    }

    async function setPath(path: Node[]) {
        _setPath(path);
        setFocusIndex(-1);

        const new_children = { nodes: null, error: null };
        setChildren(new_children);
        let nodes: Node[] = [];
        let error = null;
        try {
            nodes = await listChildren(path);
        } catch (ex) {
            error = String(ex);
        }
        // Only install the new nodes (or the error) when no other
        // call to setPath has happened in the mean time. When
        // such a call happens, the "children" state variable will
        // no longer be equal to the "new_children" container that
        // we have created for us.
        setChildren(currentChildren => {
            if (Object.is(currentChildren, new_children)) {
                // Return a new object again, to guarantee that a
                // render is actually triggered.
                return { nodes, error };
            } else
                return currentChildren;
        });

        if (formatSelected && path[path.length - 1]?.isSelectable) {
            setFormattedSelected(await formatSelected(followLinks(path)));
        }
    }

    const preparedFilters = (
        filters && filters.length > 1 &&
            <ToggleGroup>
                {
                    filters.map(f => {
                        return (
                            <ToggleGroupItem
                                key={f.label}
                                isSelected={f == filter}
                                onChange={() => {
                                    setFilter(f);
                                    textInputRef.current?.focus();
                                }}
                                text={f.label}
                            />
                        );
                    })
                }
            </ToggleGroup>
    );

    const textFilter = (
        <TextInput
            ref={textInputRef}
            placeholder={_("Type to filter")}
            value={textInput}
            onChange={(_event, value) => setTextInput(value)}
            onKeyDown={onFilterInputKeyDown}
        />
    );

    const breadcrumbs: React.ReactNode[] = [];
    path.map(formatHeader).forEach((h, i) => {
        if (h) {
            breadcrumbs.push(
                <BreadcrumbItem
                    key={i}
                    to="#"
                    onClick={
                        (event) => {
                            setPath(path.slice(0, i + 1));
                            event.preventDefault();
                        }
                    }
                    isActive={i == path.length - 1}
                >
                     {h}
                </BreadcrumbItem>
            );
        }
    });

    function followLinks(path: Node[]) {
        let link;
        let new_path = path;
        while ((link = new_path[new_path.length - 1].link))
            new_path = link;
        return new_path;
    }

    function onNodeClick(n: Node) {
        setFocusIndex(-1);

        if (n.isLeaf) {
            if (n.isSelectable) {
                setSelected(n);
                if (formatSelected)
                    formatSelected(followLinks(path.concat(n))).then(setFormattedSelected);
            } else {
                setSelected(null);
                setFormattedSelected(null);
            } return;
        }

        setTextInput("");
        setSelected(null);
        setFormattedSelected(null);
        setPath(followLinks(path.concat(n)));
    }

    const { nodes, error } = children;
    const filteredNodes = nodes && nodes.filter(n => n.name.includes(filterText) && (!filter || filter.filter(n)));
    const filteredHeader = nodes && filteredNodes && filteredNodes.length < nodes.length && cockpit.format("($0 / $1)", filteredNodes.length, nodes.length);

    function boldify(name: string): React.ReactNode {
        if (!filterText)
            return name;
        const parts: React.ReactNode[] = [];
        let pos;
        while ((pos = name.indexOf(filterText)) >= 0) {
            parts.push(name.substring(0, pos));
            parts.push(<u>{name.substring(pos, pos + filterText.length)}</u>);
            name = name.substring(pos + filterText.length);
        }
        if (name)
            parts.push(name);
        return parts;
    }

    function onFilterInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (!filteredNodes)
            return;

        switch (event.key) {
        case 'ArrowDown':
            if (focusIndex < 0 || focusIndex >= filteredNodes.length - 1)
                setFocusIndex(0);
            else
                setFocusIndex(val => val + 1);
            break;

        case 'ArrowUp':
            if (focusIndex <= 0)
                setFocusIndex(filteredNodes.length - 1);
            else
                setFocusIndex(val => val - 1);
            break;

        case 'Enter':
            if (filteredNodes && filteredNodes.length == 1) {
                onNodeClick(filteredNodes[0]);
                return;
            }
            if (filteredNodes && focusIndex >= 0 && focusIndex < filteredNodes.length) {
                onNodeClick(filteredNodes[focusIndex]);
            }
            break;
        }
    }

    const selectedStyle = { background: "var(--pf-t--global--color--nonstatus--blue--default)" };
    const focusedStyle = { border: "solid 1px black" };

    return (
        <>
            <Modal
                isOpen={isOpen}
                variant="large"
                position="top"
            >
                <ModalHeader
                    title={title}
                    description={
                        errorMessage &&
                            <Alert
                                variant='danger'
                                isInline
                                title={errorMessage}
                            />
                    }
                />
                <Split>
                    <SplitItem style={{ width: 200 }}>
                        <ModalBody>
                            <Table variant="compact" borders={false}>
                                <Tbody>
                                    {
                                        roots.map(r => {
                                            return (
                                                <Tr
                                                    key={r.label}
                                                    isClickable
                                                    isSelectable
                                                    isRowSelected={path[0] == r.root}
                                                    onRowClick={() => {
                                                        setRoot(r);
                                                        setSelected(null);
                                                        textInputRef.current?.focus();
                                                    }}
                                                >
                                                    <Td>{r.label}</Td>
                                                </Tr>
                                            );
                                        })
                                    }
                                </Tbody>
                            </Table>
                        </ModalBody>
                    </SplitItem>
                    <SplitItem isFilled>
                        {
                            breadcrumbs.length > 0 &&
                                <ModalHeader>
                                    <Breadcrumb
                                        style={
                                            {
                                                // align left of breadcrumb with left of table content
                                                paddingInlineStart: "var(--pf-t--global--spacer--inset--page-chrome"
                                            }
                                        }
                                    >
                                        {breadcrumbs}
                                    </Breadcrumb>
                                </ModalHeader>
                        }
                        <ModalBody style={{ height: 300 }}>
                            <Table variant="compact" borders={false}>
                                { nodes == null && <Caption><Spinner /></Caption> }
                                { nodes && nodes.length == 0 && <Caption>{error || _("empty")}</Caption> }
                                { nodes && nodes.length > 0 && filteredNodes && filteredNodes.length == 0 && <Caption>nothing matches</Caption> }
                                { filteredNodes && filteredNodes.length > 0 &&
                                    <Tbody>
                                        {
                                            filteredNodes.map(
                                                (n, idx) => {
                                                    return (
                                                        <Tr
                                                            style={
                                                                {
                                                                    ...(n == selected ? selectedStyle : {}),
                                                                    ...(idx == focusIndex ? focusedStyle : {})
                                                                }
                                                            }
                                                            key={n.name}
                                                            onRowClick={() => onNodeClick(n)}
                                                            isClickable
                                                        >
                                                            <Td>{boldify(n.name)}</Td>
                                                            { formatExtraColumns(n).map((c, i) => <Td key={i}>{c}</Td>) }
                                                        </Tr>
                                                    );
                                                }
                                            )
                                        }
                                    </Tbody>
                                }
                            </Table>
                        </ModalBody>
                    </SplitItem>
                </Split>
                <ModalFooter>
                    {formattedSelected}
                    <Flex>
                        <FlexItem>
                            <Button
                                isDisabled={!selected && !(path.length > 0 && path[path.length - 1].isSelectable)}
                                isLoading={inProgress}
                                onClick={
                                    async () => {
                                        setInProgress(true);
                                        setErrorMessage("");
                                        try {
                                            if (selected)
                                                await onSelect(followLinks(path.concat(selected)));
                                            else
                                                await onSelect(path);
                                            setIsOpen(false);
                                        } catch (ex) {
                                            setErrorMessage(String(ex));
                                        }
                                        setInProgress(false);
                                    }
                                }
                            >
                                {selectTitle}
                            </Button>
                        </FlexItem>
                        <FlexItem>
                            <Button
                                variant="link"
                                onClick={() => setIsOpen(false)}
                                isDisabled={inProgress}
                            >
                                {_("Cancel")}
                            </Button>
                        </FlexItem>
                        <FlexItem grow={{default: "grow"}} />
                        <FlexItem>
                            {filteredHeader}
                        </FlexItem>
                        <FlexItem>
                            {preparedFilters}
                        </FlexItem>
                        <FlexItem>
                            {textFilter}
                        </FlexItem>
                    </Flex>
                </ModalFooter>
            </Modal>
            <Button onClick={() => setIsOpen(true)} {...buttonProps} />
        </>
    );
}
