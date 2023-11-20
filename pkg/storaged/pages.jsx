/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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

import cockpit from "cockpit";
import React, { useState, useRef } from "react";
import client from "./client";
import { useEvent } from "hooks.js";

import { AlertGroup } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Card, CardHeader, CardTitle, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DropdownGroup, DropdownList } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Bullseye } from "@patternfly/react-core/dist/esm/layouts/Bullseye/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { ExclamationTriangleIcon, ExclamationCircleIcon } from "@patternfly/react-icons";
import { Page, PageBreadcrumb, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { decode_filename, block_short_name, fmt_size } from "./utils.js";
import { StorageButton, StorageBarMenu, StorageMenuItem, StorageSize } from "./storage-controls.jsx";
import { MultipathAlert } from "./multipath.jsx";
import { JobsPanel } from "./jobs-panel.jsx";

const _ = cockpit.gettext;

/* PAGES and CARDS

   This is the central hub of the Storage application. It implements a
   couple of concepts: "page", "card", "crossref", and "action". It
   also implements the React components that construct the actual UI
   out of them.

   On every change of the client, a tree of pages is constructed. Each
   page has a list of cards on it. The cards each have a list of
   actions. In addition to that, there are a few crossrefs (cross
   references) between pages that don't follow the tree structure.

   The tree of pages starts with "make_overview_page" in
   overview/overview.jsx. That function creates the data structures
   that represent the overview page (using functions exported from
   this file), and is also responsible for kicking of the creation of
   its child pages. (And each page construction function of course
   also creates the cards and actions for that page).

   Pages can be shown by themselves, or be part of various tables in
   other pages. For example, each row in the table in the overview
   page represents another page, and clicking on it will navigate to
   that page. (In fact, the overview table shows the whole tree. Other
   apges show subsets of the tree in their tables.)

   Most of the complications with pages and cards are there to support
   putting pages into tables. Without having to do that, we wouldn't
   need the pages and cards abstractions at all.

   A page derives its "ID", "Type", "Location", and "Size" properties
   from its cards in various ad-hoc and arguably too complex
   ways. This is seems necessary since the cards that end up together
   on a page can vary significantly depending on the actual storage
   configuration of the machine.

   For example, a MDRAID device might have a encrypted LVM2 physical
   volume directly on it, or it might have a partition table with a
   PV, in which case the card for the PV appears on another page
   together with a card for the partition.

   Cards are constructed with a call like this:

       const card = new_card({
           next: next_card,
           title: ...,
           component: CardComponent,
           props: { react_props... }
       });

   A page is constructed with a call like this:

       new_page(parent_page, first_card, { options... });

   A call to "new_page" will implicitly build the tree by inserting
   the new_page into the children of "parent_page".

   The main React component for this application is StoragePage. It
   will find the correct page for the browser URL and display it,
   together with all the trimmings like the breadcrumb trail.

   The page will be filled with the React components specified by its
   cards. Such a component should use StorageCard to get the standard
   look of all cards, and to work well with the test helpers.

   Tables of pages are handled by the PageTable component exported
   from this file or, more likely, its specialized version
   ChildrenTable.

   A ChildrenTable shows all direct and indirect children of a given
   page, by using a PageTable appropriately. A raw PageTable can also
   show cross references.

   A cross reference associates a page with an arbitrary key. For
   example, a page that represents a LVM2 physical volume will
   associate itself with the DBusProxy for its volume group. The page
   for the volume group will then retrieve all pages associated with
   its DBusProxy and put them into a table to show all its physical
   volumes.

   When a page appears in such a crossref table, it has dedicated
   actions, a dedicated size, and generally looks different from when
   it appears in a "normal" childrens table. This is another source of
   complication of how cards and pages interact.
*/

let pages = null;
let crossrefs = null;

export function reset_pages() {
    pages = new Map();
    crossrefs = new Map();
}

function name_from_card(card) {
    if (!card)
        return null;
    return name_from_card(card.next) || card.page_name;
}

function icon_from_card(card) {
    if (!card)
        return null;
    return icon_from_card(card.next) || card.page_icon;
}

function key_from_card(card) {
    if (!card)
        return null;
    return key_from_card(card.next) || card.page_key;
}

function location_from_card(card) {
    if (!card)
        return null;
    return location_from_card(card.next) || card.page_location;
}

function size_from_card(card) {
    if (!card)
        return null;
    if (card.page_size)
        return card.page_size;
    return size_from_card(card.next);
}

export function new_page(parent, card, options) {
    const page = {
        location: location_from_card(card),
        name: name_from_card(card),
        icon: icon_from_card(card),
        key: key_from_card(card),
        parent,
        children: [],
        card,
        options: options || {},
    };
    page.columns = [
        card.title,
        card.location,
        size_from_card(card),
    ];
    if (parent)
        parent.children.push(page);
    while (card) {
        card.page = page;
        card = card.next;
    }
    if (page.location) {
        pages.set(JSON.stringify(page.location), page);
        if (page.location.length == 0) {
            // This is the Overview page. Make it the parent of the
            // special "not found" page (but don't make the "not
            // found" page a child of the Overview...)
            not_found_page.parent = page;
        }
    }
    return page;
}

export function new_card({
    title, location, next,
    type_extra, id_extra,
    page_name, page_icon, page_key, page_location, page_size,
    page_block,
    for_summary,
    has_warning, has_danger, job_path,
    component, props,
    actions,
}) {
    if (page_block) {
        page_location = [block_location(page_block)];
        page_name = block_short_name(page_block);
        page_size = page_block.Size;
        job_path = page_block.path;
    }
    return {
        title,
        location,
        next,
        type_extra,
        page_name,
        page_icon,
        page_key,
        page_location,
        page_size,
        for_summary,
        component,
        props,
        has_warning,
        has_danger,
        job_path,
        actions: actions ? actions.filter(a => !!a) : null,
        id_extra,
    };
}

export function register_crossref(crossref) {
    const val = crossrefs.get(crossref.key) || [];
    crossref.actions = crossref.actions ? crossref.actions.filter(a => !!a) : null;
    val.push(crossref);
    crossrefs.set(crossref.key, val);
}

export function get_crossrefs(key) {
    return crossrefs.get(key);
}

/* Getting the page for a navigation location.
 *
 * We have a special "not found" page that is returned when there is
 * no real page at the given location.
 */

const NotFoundCard = ({ card }) => {
    return <span>{_("Not found")}</span>;
};

const not_found_page = new_page(null, new_card({ page_name: _("Not found"), component: NotFoundCard }));

export function get_page_from_location(location) {
    return pages?.get(JSON.stringify(location)) || not_found_page;
}

/* Common UI things
 */

export function navigate_away_from_card(card) {
    if (!card)
        return;

    const loc = cockpit.location;
    const page = card.page;
    if (page.parent && JSON.stringify(loc.path) == JSON.stringify(page.location))
        loc.go(page.parent.location);
}

export function navigate_to_new_card_location(card, location) {
    if (!card)
        return;

    const loc = cockpit.location;
    const page = card.page;
    if (JSON.stringify(loc.path) == JSON.stringify(page.location))
        loc.go(location);
}

function make_menu_item(action) {
    return <StorageMenuItem key={action.title} onClick={() => action.action(true)}
                            danger={action.danger} excuse={action.excuse}>
        {action.title}
    </StorageMenuItem>;
}

function make_page_kebab(page) {
    const items = [];

    function card_item_group(card) {
        const a = card.actions || [];
        if (a.length > 0) {
            let result = <DropdownList key={items.length}>{a.map(make_menu_item)}</DropdownList>;
            if (card.title) {
                result = <DropdownGroup key={items.length} label={card.title} className="storage-menu-title">
                    {result}
                </DropdownGroup>;
            }
            return result;
        } else
            return null;
    }

    let c = page.card;
    while (c) {
        const g = card_item_group(c);
        if (g)
            items.push(g);
        c = c.next;
    }

    if (items.length == 0)
        return null;

    return <StorageBarMenu menuItems={items} isKebab />;
}

function make_actions_kebab(actions) {
    if (!actions || actions.length == 0)
        return null;

    return <StorageBarMenu menuItems={actions.map(make_menu_item)} isKebab />;
}

const ActionButtons = ({ card }) => {
    const narrow = useIsNarrow();

    function for_menu(action) {
        // Determine whether a action should get a button or be in the
        // menu

        // In a narrow layout, everything goes to the menu
        if (narrow)
            return true;

        // Everything that is dangerous goes to the menu
        if (action.danger)
            return true;

        return false;
    }

    const buttons = [];
    const items = [];

    if (!card.actions)
        return null;

    for (const a of card.actions) {
        if (for_menu(a))
            items.push(make_menu_item(a));
        else
            buttons.push(
                <StorageButton key={a.title} onClick={() => a.action(false)}
                               kind={a.danger ? "danger" : null} excuse={a.excuse}>
                    {a.title}
                </StorageButton>);
    }

    if (items.length > 0)
        buttons.push(<StorageBarMenu key="menu" menuItems={items} isKebab />);

    return buttons;
};

function page_type_extra(page) {
    const extra = [];
    let c = page.card;
    while (c) {
        if (c.type_extra)
            extra.push(c.type_extra);
        c = c.next;
    }
    return extra;
}

function page_type(page) {
    const type = page.card.title;
    const extra = page_type_extra(page);
    if (extra.length > 0)
        return type + " (" + extra.join(", ") + ")";
    else
        return type;
}

// PAGE_BLOCK_SUMMARY
//
// Describe a page in a way that is useful to identify it when
// deciding which block device to format, or which block devices to
// make a volume group out of, for example. The block device itself
// (such as /dev/sda5) should not be part of the description; it is in
// another table column already.
//
// The first card on the page that has the "for_summary" flag set
// provides the description, and the type extra of all cards
// leading to it are added.  The description is either the title
// of the card, or its id_extra.
//
// For more context, the description for the parent of a page is also
// added.
//
// Thus, we end up with things like "Partition - MDRAID device".

function page_block_summary_1(page) {
    let description = null;
    const extra = [];
    for (let card = page.card; card; card = card.next) {
        if (card.for_summary) {
            description = card.id_extra || card.title;
            break;
        }
        if (card.type_extra)
            extra.push(card.type_extra);
    }

    if (description && extra.length > 0)
        description += " (" + extra.join(", ") + ")";

    return description;
}

function page_block_summary(page) {
    const desc1 = page_block_summary_1(page);
    const desc2 = page.parent && page.parent.parent && page_block_summary_1(page.parent);
    if (desc1 && desc2)
        return desc1 + " - " + desc2;
    else
        return desc1 || desc2;
}

let narrow_query = null;

export const useIsNarrow = (onChange) => {
    if (!narrow_query) {
        const val = window.getComputedStyle(window.document.body).getPropertyValue("--pf-v5-global--breakpoint--md");
        narrow_query = window.matchMedia(`(max-width: ${val})`);
    }
    useEvent(narrow_query, "change", onChange);

    return narrow_query.matches;
};

export const PageTable = ({ emptyCaption, aria_label, pages, crossrefs, sorted, show_icons }) => {
    const [collapsed, setCollapsed] = useState(true);
    const firstKeys = useRef(false);
    const narrow = useIsNarrow(() => { firstKeys.current = false });

    let rows = [];
    const row_keys = new Set();

    function make_row(page, crossref, level, border, key) {
        function card_has_danger(card) {
            if (card)
                return card.has_danger || card_has_danger(card.next);
            else
                return false;
        }

        function card_has_warning(card) {
            if (card)
                return card.has_warning || card_has_warning(card.next);
            else
                return false;
        }

        function card_has_job(card) {
            if (card)
                return client.path_jobs[card.job_path] || card_has_job(card.next);
            else
                return false;
        }

        let info = null;
        if (card_has_job(page.card))
            info = <>{"\n"}<Spinner isInline size="md" /></>;
        if (card_has_danger(page.card))
            info = <>{"\n"}<ExclamationCircleIcon className="ct-icon-times-circle" />{info}</>;
        else if (card_has_warning(page.card))
            info = <>{"\n"}<ExclamationTriangleIcon className="ct-icon-exclamation-triangle" />{info}</>;

        const icon = (show_icons && page.icon) ? <page.icon /> : null;
        const name = crossref ? page.name : page_display_name(page);
        const type = crossref ? page_block_summary(page) : page_type(page);
        const location = crossref ? crossref.extra : page.columns[1];
        let size = crossref ? crossref.size : page.columns[2];
        const actions = crossref ? make_actions_kebab(crossref.actions) : make_page_kebab(page);

        if (typeof size === "number") {
            if (narrow)
                size = fmt_size(size);
            else
                size = <StorageSize size={size} />;
        }

        function onClick(event) {
            if (!event || event.button !== 0)
                return;

            if (page.location)
                cockpit.location.go(page.location);
        }

        function is_clickable(element) {
            return element.classList.contains("pf-m-clickable");
        }

        function next_clickable_sibling(element) {
            do {
                const next = element.nextElementSibling;
                if (next && is_clickable(next))
                    return next;
                element = next;
            } while (element);

            return null;
        }

        function previous_clickable_sibling(element) {
            do {
                const prev = element.previousElementSibling;
                if (prev && is_clickable(prev))
                    return prev;
                element = prev;
            } while (element);

            return null;
        }

        function onRowKeyDown(event) {
            const { code, target } = event;

            if (target.nodeName == "TR") {
                if (code == "Space" || code == "Enter") {
                    if (page.location)
                        cockpit.location.go(page.location);
                    event.preventDefault();
                }
                if (code == "ArrowDown") {
                    const next = next_clickable_sibling(target);
                    if (next)
                        next.focus();
                    event.preventDefault();
                }
                if (code == "ArrowUp") {
                    const prev = previous_clickable_sibling(target);
                    if (prev)
                        prev.focus();
                    event.preventDefault();
                }
            }
        }

        const is_new = firstKeys.current != false && !firstKeys.current.has(key);
        row_keys.add(key);

        if (narrow) {
            rows.push(
                <Card key={key} onClick={onClick}
                      className={"ct-small-table-card" +
                                 (page.location ? " ct-clickable-card" : null) +
                                 (is_new ? " ct-new-item" : "")}
                      data-test-row-name={page.name}
                      data-test-row-location={page.columns[1]}>
                    <CardBody>
                        <Split hasGutter>
                            { icon && <SplitItem>{icon}</SplitItem> }
                            <SplitItem isFilled><strong>{name}</strong>{info}</SplitItem>
                            <SplitItem>{actions}</SplitItem>
                        </Split>
                        <Split hasGutter isWrappable>
                            <SplitItem>{type}</SplitItem>
                            <SplitItem isFilled>{location}</SplitItem>
                            <SplitItem isFilled className="pf-v5-u-text-align-right">{size}</SplitItem>
                        </Split>
                    </CardBody>
                </Card>);
        } else {
            const cols = [
                <Td key="1" onClick={onClick}><span>{name}{info}</span></Td>,
                <Td key="2" onClick={onClick}>{type}</Td>,
                <Td key="3" onClick={onClick}>{location}</Td>,
                <Td key="4" onClick={onClick} className="storage-size-column">{size}</Td>,
                <Td key="5" className="pf-v5-c-table__action">{actions || <div /> }</Td>,
            ];
            if (show_icons)
                cols.unshift(<Td key="0" onClick={onClick} className="storage-device-icon">{icon}</Td>);

            rows.push(
                <Tr key={key}
                    className={"content-level-" + level +
                               (border ? "" : " remove-border") +
                               (is_new ? " ct-new-item" : "")}
                    data-test-row-name={page.name} data-test-row-location={page.columns[1]}
                    isClickable={!!page.location}
                    onKeyDown={onRowKeyDown}>
                    {cols}
                </Tr>);
        }
    }

    function sort(things, accessor, sorted) {
        if (sorted === false)
            return things;
        return things.toSorted((a, b) => accessor(a).localeCompare(accessor(b)));
    }

    function make_page_rows(pages, level, last_has_border, key, sorted) {
        for (const p of sort(pages, p => p.name, sorted)) {
            const is_last = (level == 0 || p == pages[pages.length - 1]);
            const p_key = key + ":" + (p.key || p.name);
            make_row(p, null, level, is_last && p.children.length == 0 && last_has_border, p_key);
            make_page_rows(p.children, level + 1, is_last && last_has_border, p_key, p.options.sorted);
        }
    }

    function make_crossref_rows(crossrefs) {
        for (const c of sort(crossrefs, c => c.card.page.name, sorted))
            make_row(c.card.page, c, 0, true, c.card.page.name);
    }

    if (pages)
        make_page_rows(pages, 0, true, "", sorted);
    else if (crossrefs)
        make_crossref_rows(crossrefs);

    if (firstKeys.current === false)
        firstKeys.current = row_keys;
    else {
        firstKeys.current.forEach(v => {
            if (!row_keys.has(v))
                firstKeys.current.delete(v);
        });
    }

    if (rows.length == 0) {
        return <EmptyState>
            <EmptyStateBody>
                {emptyCaption}
            </EmptyStateBody>
        </EmptyState>;
    }

    let show_all_button = null;
    if (rows.length > 50 && collapsed) {
        show_all_button = (
            <Bullseye>
                <Button variant='link'
                        onKeyDown={ev => ev.key === "Enter" && setCollapsed(false)}
                        onClick={() => setCollapsed(false)}>
                    {cockpit.format(_("Show all $0 rows"), rows.length)}
                </Button>
            </Bullseye>);
        rows = rows.slice(0, 50);
    }

    return (
        <div>
            { narrow
                ? rows
                : <Table aria-label={aria_label}
                       variant="compact">
                    { pages &&
                    <Thead>
                        <Tr>
                            { show_icons && <Th /> }
                            <Th>{_("ID")}</Th>
                            <Th>{_("Type")}</Th>
                            <Th>{_("Location")}</Th>
                            <Th className="storage-size-column-header">{_("Size")}</Th>
                            <Th />
                        </Tr>
                    </Thead>
                    }
                    <Tbody>
                        {rows}
                    </Tbody>
                </Table>
            }
            {show_all_button}
        </div>);
};

export const ChildrenTable = ({ emptyCaption, aria_label, page, show_icons }) => {
    return <PageTable emptyCaption={emptyCaption}
                      aria_label={aria_label}
                      pages={page.children}
                      sorted={page.options.sorted}
                      show_icons={show_icons} />;
};

function page_id_extra(page) {
    let extra = "";
    let c = page.card;
    while (c) {
        if (c.id_extra)
            extra += " " + c.id_extra;
        c = c.next;
    }
    return extra;
}

function page_display_name(page) {
    let name = page.name;
    const extra = page_id_extra(page);
    if (extra)
        name = name + " - " + extra;
    return name;
}

const PageCardStackItems = ({ page, plot_state }) => {
    const items = [];
    let c = page.card;
    while (c) {
        items.push(<React.Fragment key={items.length}>
            <StackItem>
                <c.component card={c} plot_state={plot_state} {...c.props} />
            </StackItem>
        </React.Fragment>);
        c = c.next;
    }

    return items.reverse();
};

export function block_location(block) {
    return decode_filename(block.PreferredDevice).replace(/^\/dev\//, "");
}

export const StorageCard = ({ card, alert, alerts, actions, children }) => {
    return (
        <Card data-test-card-title={card.title}>
            <CardHeader actions={{ actions: actions || <ActionButtons card={card} /> }}>
                <CardTitle>{card.title}</CardTitle>
            </CardHeader>
            {(alert || (alerts && alerts.length > 0)) && <CardBody><AlertGroup>{alert}{alerts}</AlertGroup></CardBody>}
            {children}
            <JobsPanel client={client} path={card.job_path} />
        </Card>);
};

export const StorageDescription = ({ title, value, action, children }) => {
    if (!value && !action && !children)
        return null;

    let content;
    if (action && value) {
        content = (
            <Flex>
                <FlexItem data-test-value>{value}</FlexItem>
                <FlexItem data-test-action>{action}</FlexItem>
            </Flex>);
    } else {
        content = value || action;
    }

    return (
        <DescriptionListGroup data-test-desc-title={title}>
            <DescriptionListTerm>{title}</DescriptionListTerm>
            <DescriptionListDescription data-test-value={!(action && value)}>
                {content}{children}
            </DescriptionListDescription>
        </DescriptionListGroup>);
};

export const StoragePage = ({ location, plot_state }) => {
    const page = get_page_from_location(location);

    const parent_crumbs = [];
    let pp = page.parent;
    while (pp) {
        parent_crumbs.unshift(
            <BreadcrumbItem key={pp.name} to={"#" + cockpit.location.encode(pp.location)}>
                {page_display_name(pp)}
            </BreadcrumbItem>
        );
        pp = pp.parent;
    }

    return (
        <Page id="storage">
            <PageBreadcrumb stickyOnBreakpoint={{ default: "top" }}>
                <Breadcrumb>
                    { parent_crumbs }
                    <BreadcrumbItem isActive>{page_display_name(page)}</BreadcrumbItem>
                </Breadcrumb>
            </PageBreadcrumb>
            <PageSection isFilled={false}>
                <Stack hasGutter>
                    <MultipathAlert client={client} />
                    <PageCardStackItems page={page} plot_state={plot_state} noarrow />
                </Stack>
            </PageSection>
        </Page>
    );
};
