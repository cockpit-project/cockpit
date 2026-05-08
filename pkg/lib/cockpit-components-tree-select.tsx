/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState, useEffect, useRef } from 'react';
import { useInit } from 'hooks';

import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { Bullseye } from '@patternfly/react-core/dist/esm/layouts/Bullseye/index.js';
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { ToggleGroup, ToggleGroupItem } from '@patternfly/react-core/dist/esm/components/ToggleGroup/index.js';
import { MenuToggle, MenuToggleElement } from '@patternfly/react-core/dist/esm/components/MenuToggle/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { MenuFooter, MenuSearch } from '@patternfly/react-core/dist/esm/components/Menu/index.js';
import { Select, SelectOption, SelectList } from '@patternfly/react-core/dist/esm/components/Select/index.js';

const _ = cockpit.gettext;

/* TreeSelect - a mostly general purpose widget for selecting
                something from a tree of choices.

   The main application is for a file chooser, and that might show.

   The tree is constructed dynamically and asynchronously while the
   user browses it. There are lists of shortcuts (such as "Recent"),
   prepared filters (such as "all ISO files"), and free text
   filtering. This widget is supposed to be pleasant to use with only
   the keyboard.

   The tree is made up of nodes.  Each node has a name and a list of
   children.  The current position in the tree is stored as a "path"
   of nodes, which is an array of nodes.  The TreeSelect shows the
   child nodes of the last node of that array and the user can click
   on them.  (Or navigate with the keyboard to one and hit Enter.)
   What happens then is partly up to the code that has instantiated
   the TreeSelect.  Sometimes the widget is told to navigate to the
   node, sometimes the node is accepted as the final user choice and
   the dropdown closes.

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
     to compute them, see below.

     A node can also have a "link" field, which is also an array of
     TreeNode<N>.  When such a node is selected, the link becomes the
     new browsing location. (Thus, this is always an absolute link.)
     Links are used for shortcuts, such as the "Recent" list.

   - TreeRoot<N>

     A TreeRoot is a "label" (string) plus a "root" (TreeNode<N>).
     The label goes into the toggle button and when the user clicks on
     that, the root becomes the new browsing location.

     A TreeRoot also defines pre-made filters, as a list of TreeFilter
     objects.  These filters are shown when their root is selected.

   - TreeFilter<N>

     A "label" (string) plus a function "filter".  The label is shown
     in a toggle button in the footer of the dropdown, and when it is
     selected by the user, the "filter" function is called for each of
     the nodes in the list and only the ones where it returns true are
     shown.

   TreeSelect properties:

   - roots: TreeRoot[]

     This is the array of TreeRoot objects used for the toggle
     buttons.

   - formatHeader: (path: TreeNode[]) => ReactNode

     This function is called with the current path to compute whatever
     should be displayed above the list of current children.  This
     will typically render each "name" of each node in "path" in
     order, in some way to indicate that this is your positition in
     the tree.

   - listChildren: (path: TreeNode[]) => Promise<TreeNode[]>

     This function will be called to compute the children of the last
     node in "path".  The whole path is passed since all nodes in the
     path are normally important.  When the nodes are files in the
     filesystem, then each element of "path" represents a directory.

     It's ok to throw an error in this function. It will be caught and
     rendered nicely.

   - parseTextInput: (value: string) => [null | TreeNode[], string]

     This function is called whenever the user changes the text input
     that is normally used for filtering.  This function is meant to
     recogize special values and can tell the TreeSelect component to
     immediately navigate somewhere else. This is used to support
     pasting a complete pathname into a file chooser, for example.

     The idea is that the function splits the string in text input
     into two parts: one that describes a path of nodes, and the
     another (the rest) that is used to filter the children of the
     location described by the path.

   - value: ReactNode

     This is shown in the dropdown toggle and not used for anything
     else.  Typically, this is a representation of the last node that
     was accepted by "onChange" (see below), of course.  Maybe
     rendered by the same function as used for "formatHeader", or
     maybe something else.

   - placeholder: ReactNode

     This is shown when nothing has been selected, that is, exactly
     when "value" is falsy.

   - onChange: (path: TreeNode[]) => boolean

     This function is called when the user selects a node from the
     list of children.  The "path" argument is the current browsing
     location extended with the node that has been clicked on.

     When the "onChange" function returns true, the selection is
     considered accepted and the dropdown is closed.  The "onChange"
     would typically transform the path into something that is useful
     for the rest of the code and remember it in the dialog state.
     Also "value" should be updated to show that the node was
     accepted.

     When the function returns false, the dropdown remains open and
     uses "path" as the new browsing location.
 */

/*
   TODO

   [x] When onChange returns true, browse to parent of accepted node.
   [x] Catch errors in listChildren and render them.
   [x] Let people paste complete values into filter input, somehow
   [ ] Easy way to clear filters (still needed?)
   [ ] Keep menu at constant height
   [ ] Support for footer actions like "Create new directory"
   [ ] Polish, use PF variables for styling, etc.
 */

export interface TreeNode<N extends TreeNode<N>> {
    name: string;
    children?: undefined | N[];
    link?: undefined | N[];
}

export interface TreeFilter<N extends TreeNode<N>> {
    label: string;
    filter: (node: N) => boolean;
}

export interface TreeRoot<N extends TreeNode<N>> {
    label: string;
    root: N;
    filters: TreeFilter<N>[];
}

interface TreeChildren<N> {
    nodes: N[] | null;
    error: string | null;
}

export function TreeSelect<Node extends TreeNode<Node>>({
    roots,
    formatHeader,
    listChildren,
    parseTextInput = null,
    value,
    placeholder = "",
    onChange,
    isDisabled = false,
} : {
    roots: TreeRoot<Node>[],
    formatHeader: (path: Node[]) => React.ReactNode,
    listChildren: (path: Node[]) => Promise<Node[]>,
    parseTextInput?: null | ((value: string) => [null | Node[], string]),
    value: React.ReactNode,
    placeholder?: React.ReactNode,
    onChange: (path: Node[]) => boolean,
    isDisabled?: boolean,
}) {
    const [isOpen, _setIsOpen] = useState(false);
    const [root, _setRoot] = useState<TreeRoot<Node> | null>(null);
    const [path, _setPath] = useState<Node[]>([]);
    const [children, setChildren] = useState<TreeChildren<Node>>({ nodes: null, error: null });
    const [filter, setFilter] = useState<TreeFilter<Node> | null>(null);
    const [textInput, _setTextInput] = useState<string>("");
    const [filterText, setFilterText] = useState<string>("");
    const [focusIndex, setFocusIndex] = useState<number>(-1);
    const textInputRef = useRef<HTMLInputElement>(null);

    function setIsOpen(isOpen: boolean) {
        _setIsOpen(isOpen);
        if (isOpen) {
            setFilter(root?.filters[0] || null);
            setTextInput("");
        }
    }

    function setRoot(r: TreeRoot<Node>) {
        if (!root || r.filters != root.filters)
            setFilter(r.filters[0] || null);
        _setRoot(r);
        setPath([r.root]);
    }

    async function setPath(path: Node[]) {
        _setPath(path);
        const cur = path[path.length - 1];
        setFocusIndex(-1);
        if (cur.children === undefined) {
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
        } else {
            setChildren({ nodes: cur.children, error: null });
        }
    }

    function setTextInput(value: string) {
        _setTextInput(value);
        if (parseTextInput) {
            const [new_path, filter] = parseTextInput(value);
            if (new_path && !Object.is(new_path, path))
                setPath(new_path);
            setFilterText(filter);
        } else
            setFilterText(value);
    }

    useInit(() => {
        setRoot(roots[0]);
    });

    useEffect(() => {
        // Focus the filter input as soon as it exists
        if (isOpen && textInputRef.current)
            textInputRef.current.focus();
    }, [
        isOpen,
        textInputRef,
    ]);

    function goUp() {
        if (path.length > 1) {
            setPath(path.slice(0, path.length - 1));
            textInputRef.current?.focus();
        }
    }

    const footer = (
        <MenuFooter>
            <Flex rowGap={{ default: 'rowGap2xl' }} flexWrap={{ default: "nowrap" }}>
                <FlexItem>
                    <Button
                        isInline
                        variant="link"
                        onClick={goUp}
                    >
                        {_("Up")}
                    </Button>
                </FlexItem>
                {
                    roots.length > 1 &&
                        <FlexItem>
                            <ToggleGroup isCompact>
                                {
                                    roots.map(r => {
                                        return (
                                            <ToggleGroupItem
                                                key={r.label}
                                                isSelected={r == root}
                                                onChange={() => {
                                                    setRoot(r);
                                                    textInputRef.current?.focus();
                                                }}
                                                text={r.label}
                                            />
                                        );
                                    })
                                }
                            </ToggleGroup>
                        </FlexItem>
                }
                {
                    root && root.filters.length > 1 &&
                        <FlexItem>
                            <ToggleGroup isCompact>
                                {
                                    root.filters.map(f => {
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
                        </FlexItem>
                }
                <FlexItem grow={{ default: 'grow' }}>
                    <input
                        ref={textInputRef}
                        type="text"
                        style={{ width: "100%" }}
                        placeholder={_("Type to filter")}
                        value={textInput}
                        onChange={event => setTextInput(event.target.value)}
                        onKeyDown={onFilterInputKeyDown}
                    />
                </FlexItem>
            </Flex>
        </MenuFooter>
    );

    const header = formatHeader(path);

    function onNodeClick(n: Node) {
        let new_path = path.concat(n);

        setTextInput("");

        // Resolve links.
        let link;
        while ((link = new_path[new_path.length - 1].link))
            new_path = link;

        if (onChange(new_path)) {
            setPath(new_path.slice(0, new_path.length - 1));
            setIsOpen(false);
        } else {
            // The Select component has a global listener for the
            // "click" event that drives the onOpenChange callback.
            // That listener checks whether the event target is
            // contained within the Menu element. This breaks when the
            // event target is removed from the Menu element before
            // the global listener runs.  Our handler here will do
            // exactly that: remove the old menu item when browsing to
            // a new path. So we delay it until the next event loop round.
            window.setTimeout(() => {
                setPath(new_path);
                textInputRef.current?.focus();
            }, 0);
        }
    }

    const { nodes, error } = children;
    const filteredNodes = nodes && nodes.filter(n => n.name.includes(filterText) && (!filter || filter.filter(n)));
    const filteredHeader = filterText && nodes && filteredNodes && cockpit.format("($0 / $1)", filteredNodes.length, nodes.length);

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
        return <>{parts}</>
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

    const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
        <MenuToggle
            ref={toggleRef}
            onClick={() => setIsOpen(!isOpen)}
            isExpanded={isOpen}
            isDisabled={isDisabled}
            isFullWidth
        >
            {/* XXX - use PF variables */}
            {value || <div style={{ color: "grey" }}>{placeholder}</div>}
        </MenuToggle>
    );

    return (
        <Select
            isOpen={isOpen}
            onSelect={(_event, val) => {
                cockpit.assert(nodes);
                const n = nodes.find(n => n.name == val);
                if (n)
                    onNodeClick(n);
            }}
            toggle={toggle}
            onOpenChange={isOpen => {
                if (!isOpen)
                    setIsOpen(false);
            }}
            popperProps={{ width: "trigger" }}
            isScrollable
        >
            {
                // XXX - use PF variables
                (header || filteredHeader) &&
                    <MenuSearch>
                        <div style={{ margin: 10, marginBlockEnd: -10, color: "grey" }}>
                            <Split>
                                <SplitItem>{header}</SplitItem>
                                <SplitItem isFilled />
                                <SplitItem><small>{filteredHeader}</small></SplitItem>
                            </Split>
                        </div>
                    </MenuSearch>
            }
            <SelectList>
                { nodes == null && <Bullseye><Spinner /></Bullseye> }
                { nodes && nodes.length == 0 && <Bullseye>{error || _("empty")}</Bullseye> }
                { nodes && nodes.length > 0 && filteredNodes && filteredNodes.length == 0 && <Bullseye>not found</Bullseye> }
                { filteredNodes && filteredNodes.length > 0 &&
                    filteredNodes.map(
                        (n, idx) => {
                            return (
                                <SelectOption key={n.name} value={n.name} isFocused={idx == focusIndex}>
                                    {boldify(n.name)}
                                </SelectOption>
                            );
                        }
                    )
                }
            </SelectList>
            { footer }
        </Select>
    );
}
