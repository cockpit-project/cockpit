/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";

import React, { useEffect, useState } from 'react';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Nav } from "@patternfly/react-core/dist/esm/components/Nav/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Tooltip, TooltipPosition } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { ContainerNodeIcon, ExclamationCircleIcon, ExclamationTriangleIcon, InfoCircleIcon } from '@patternfly/react-icons';
import { Icon } from "@patternfly/react-core/dist/esm/components/Icon/index.js";

import { Status } from "notifications";
import { Location, encode_location, ManifestItem } from "./util.jsx";
import { ShellState } from "./state";
import { ManifestKeyword } from "./manifests";

const _ = cockpit.gettext;

export const SidebarToggle = () => {
    const [active, setActive] = useState(false);

    useEffect(() => {
        /* This is a HACK for catching lost clicks on the pages which live in iframes so as to close dropdown menus on the shell.
         * Note: Clicks on an <iframe> element won't trigger document.documentElement listeners, because it's literally different page with different security domain.
         * However, when clicking on an iframe moves focus to its content's window that triggers the main window.blur event.
         * Additionally, when clicking on an element in the same iframe make sure to unset the 'active' state of the 'System' dropdown selector.
         */
        const handleClickOutside = (ev: Event) => {
            if ((ev.target as Element).id == "nav-system-item")
                return;

            setActive(false);
        };

        ["blur", "click"].map(ev_type => window.addEventListener(ev_type, handleClickOutside));

        return () => {
            ["blur", "click"].map(ev_type => window.removeEventListener(ev_type, handleClickOutside));
        };
    }, []);

    useEffect(() => {
        document.getElementById("nav-system")!.classList.toggle("interact", active);
    }, [active]);

    return (
        <Button icon={
            <Icon size="xl">
                <ContainerNodeIcon />
            </Icon>}
            className={"pf-v6-c-select__toggle ct-nav-toggle " + (active ? "active" : "")}
                id="nav-system-item" variant="plain"
                onClick={() => setActive(!active)}>{_("System")}</Button>
    );
};

interface ItemGroup<T> {
    name: string;
    items: T[];
    action?: {
        label: string;
        target: Partial<Location>;
    } | undefined;
}

interface CockpitNavProps<T, X extends T> {
    groups: ItemGroup<T>[];
    selector: string;
    current: string;
    filtering: (item: T, term: string) => X | null;
    sorting: (a: X, b: X) => number;
    item_render: (item: X, term: string) => React.ReactNode;
    jump: (loc: Partial<Location>) => void;
}

interface CockpitNavState {
    search: string;
    current: string;
}

export class CockpitNav<T, X extends T> extends React.Component {
    props: CockpitNavProps<T, X>;
    state: CockpitNavState;

    constructor(props : CockpitNavProps<T, X>) {
        super(props);

        this.state = {
            search: "",
            current: props.current,
        };

        this.clearSearch = this.clearSearch.bind(this);
        this.props = props;
    }

    componentDidMount() {
        const sel = this.props.selector;
        // Click on active menu item (when using arrows to navigate through menu)
        function clickActiveItem() {
            const cur = document.activeElement;
            if (cur instanceof HTMLInputElement) {
                const el = document.querySelector<HTMLElement>("#" + sel + " li:first-of-type a");
                if (el)
                    el.click();
            } else if (cur instanceof HTMLElement) {
                cur.click();
            } else {
                console.error("Active element not a HTMLElement");
            }
        }

        // Move focus to next item in menu (when using arrows to navigate through menu)
        // With arguments it is possible to change direction
        function focusNextItem(begin: number, step: number) {
            const cur = document.activeElement;
            const all = Array.from(document.querySelectorAll<HTMLElement>("#" + sel + " li a"));
            if (cur instanceof HTMLInputElement && all.length > 0) {
                if (begin < 0)
                    begin = all.length - 1;
                all[begin].focus();
            } else {
                let i = all.findIndex(item => item === cur);
                i += step;
                if (i < 0 || i >= all.length)
                    document.querySelector<HTMLElement>("#" + sel + " .pf-v6-c-text-input-group__text-input")?.focus();
                else
                    all[i].focus();
            }
        }

        const navigate_apps = (ev: KeyboardEvent) => {
            if (ev.key == "Enter")
                clickActiveItem();
            else if (ev.key == "ArrowDown")
                focusNextItem(0, 1);
            else if (ev.key == "ArrowUp")
                focusNextItem(-1, -1);
            else if (ev.key == "Escape") {
                this.setState({ search: "" });
                document.querySelector<HTMLElement>("#" + sel + " .pf-v6-c-text-input-group__text-input")?.focus();
            }
        };

        document.getElementById(sel)?.addEventListener("keyup", navigate_apps);
    }

    static getDerivedStateFromProps(nextProps: CockpitNavProps<void, void>, prevState: CockpitNavState) {
        if (nextProps.current !== prevState.current)
            return {
                search: "",
                current: nextProps.current,
            };
        return null;
    }

    clearSearch() {
        this.setState({ search: "" });
    }

    render() {
        const groups: ItemGroup<X>[] = [];
        const term = this.state.search.toLowerCase();
        this.props.groups.forEach(g => {
            const new_items = g.items.map(i => this.props.filtering(i, term)).filter(i => i != null);
            new_items.sort(this.props.sorting);
            if (new_items.length > 0)
                groups.push({ name: g.name, items: new_items, action: g.action });
        });

        return (
            <>
                <SearchInput placeholder={_("Search")} value={this.state.search} onChange={(_, search) => this.setState({ search })} onClear={() => this.setState({ search: "" })} className="search" />
                <Nav>
                    { groups.map(g =>
                        <section className="pf-v6-c-nav__section" aria-labelledby={"section-title-" + g.name} key={g.name}>
                            <div className="nav-group-heading">
                                <h2 className="pf-v6-c-nav__section-title" id={"section-title-" + g.name}>{g.name}</h2>
                                { g.action &&
                                    <a className="pf-v6-c-nav__section-title nav-item"
                                        href={encode_location(g.action.target)}
                                        onClick={ ev => {
                                            if (g.action)
                                                this.props.jump(g.action.target);
                                            ev.preventDefault();
                                        }}>
                                        {g.action.label}
                                    </a>
                                }
                            </div>
                            <ul className="pf-v6-c-nav__list">
                                {g.items.map(i => this.props.item_render(i, this.state.search.toLowerCase()))}
                            </ul>
                        </section>
                    )}
                    { groups.length < 1 && <span className="non-menu-item no-results">{_("No results found")}</span> }
                    { this.state.search !== "" && <span className="non-menu-item"><Button variant="link" onClick={this.clearSearch} className="nav-item-hint">{_("Clear search")}</Button></span> }
                </Nav>
            </>
        );
    }
}

function PageStatus({ status, name } : { status: Status, name: string }) {
    // Generate name for the status
    const desc_parts = name.toLowerCase().split(" ");
    desc_parts.push(status.type || "");
    const desc = desc_parts.join("-");

    return (
        <Tooltip id={desc + "-tooltip"} content={status.title}
                 position={TooltipPosition.right}>
            <span id={desc} className="nav-item-status">
                {status.type == "error"
                    ? <ExclamationCircleIcon color="#f54f42" />
                    : status.type == "warning"
                        ? <ExclamationTriangleIcon className="ct-icon-exclamation-triangle" color="#f0ab00" />
                        : <InfoCircleIcon color="#73bcf7" />}
            </span>
        </Tooltip>
    );
}

function FormattedText({ keyword, term } : { keyword: string, term: string }) {
    function split_text(text: string, term: string) {
        const b = text.toLowerCase().indexOf(term);
        const e = b + term.length;
        return [text.substring(0, b), text.substring(b, e), text.substring(e, text.length)];
    }

    const s = split_text(keyword, term);
    return (
        <>{s[0]}<mark>{s[1]}</mark>{s[2]}</>
    );
}

export function CockpitNavItem(props : {
    name: string;
    header?: string;
    className?: string;
    active: boolean;
    status: Status | null;
    keyword: string;
    term: string;
    href: string;
    onClick: () => void;
    actions?: React.ReactNode;
}) {
    const s = props.status;
    const name_matches = props.keyword === props.name.toLowerCase();
    let header_matches = false;
    if (props.header)
        header_matches = props.keyword === props.header.toLowerCase();

    const classes = props.className ? [props.className] : [];
    classes.push("pf-v6-c-nav__item", "nav-item");

    return (
        <li className={classes.join(" ")}>
            <a className={"pf-v6-c-nav__link" + (props.active ? " pf-m-current" : "")}
                aria-current={props.active && "page"}
                href={props.href}
                onClick={ev => {
                    props.onClick();
                    ev.preventDefault();
                }}>
                <span className="pf-v6-c-nav__link-text">
                    { props.header && <span className="nav-item-hint">{header_matches ? <FormattedText keyword={props.header} term={props.term} /> : props.header}</span> }
                    <span className="nav-item-name">
                        { name_matches ? <FormattedText keyword={props.name} term={props.term} /> : props.name }
                    </span>
                </span>
                <span className="pf-v6-c-nav__link-icon">
                    {s && s.type && <PageStatus status={s} name={props.name} />}
                </span>
                { !name_matches && !header_matches && props.keyword && <span className="nav-item-hint nav-item-hint-contains">{_("Contains:")} <FormattedText keyword={props.keyword} term={props.term} /></span> }
            </a>
            <span className="nav-item-actions nav-host-action-buttons">
                {props.actions}
            </span>
        </li>
    );
}

interface PageKeyword {
    keyword: string;
    score: number;
    goto: string | null;
}

interface PageItem extends ManifestItem {
    keyword: PageKeyword;
}

export const PageNav = ({ state } : { state: ShellState }) => {
    const {
        current_machine,
        current_manifest_item,
        current_machine_manifest_items,
        page_status,
    } = state;

    if (!current_machine || current_machine.state != "connected")
        return null;

    cockpit.assert(current_machine_manifest_items && current_manifest_item);

    // Filtering of navigation by term
    function keyword_filter(item: ManifestItem, term: string): PageItem | null {
        function keyword_relevance(current_best: PageKeyword, item: ManifestKeyword) {
            const translate = item.translate || false;
            const weight = item.weight || 0;
            let score;
            let _m = "";
            let best: PageKeyword = { keyword: "", score: -1, goto: null };
            item.matches.forEach(m => {
                if (translate)
                    _m = _(m);
                score = -1;
                // Best score when starts in translate language
                if (translate && _m.indexOf(term) == 0)
                    score = 4 + weight;
                // Second best score when starts in English
                else if (m.indexOf(term) == 0)
                    score = 3 + weight;
                // Substring consider only when at least 3 letters were used
                else if (term.length >= 3) {
                    if (translate && _m.indexOf(term) >= 0)
                        score = 2 + weight;
                    else if (m.indexOf(term) >= 0)
                        score = 1 + weight;
                }
                if (score > best.score) {
                    best = { keyword: m, score, goto: item.goto || null };
                }
            });
            if (best.score > current_best.score) {
                current_best = best;
            }
            return current_best;
        }

        const new_item: PageItem = Object.assign({ keyword: { keyword: "", score: -1, goto: null } }, item);
        if (!term)
            return new_item;
        const best_keyword = new_item.keywords.reduce(keyword_relevance, { keyword: "", score: -1, goto: null });
        if (best_keyword.score > -1) {
            new_item.keyword = best_keyword;
            return new_item;
        }
        return null;
    }

    // Rendering of separate navigation menu items
    function nav_item(item: PageItem, term: string) {
        const active = current_manifest_item?.path === item.path;

        // Parse path
        let path = item.path;
        let hash = item.hash;
        if (item.keyword.goto) {
            if (item.keyword.goto[0] === "/")
                path = item.keyword.goto.substring(1);
            else
                hash = item.keyword.goto;
        }

        // Parse page status
        let status = null;
        if (page_status[current_machine!.key])
            status = page_status[current_machine!.key][item.path];

        const target_location = { host: current_machine!.address, path, hash };

        return (
            <CockpitNavItem key={item.label}
                            name={item.label}
                            active={active}
                            status={status}
                            keyword={item.keyword.keyword}
                            term={term}
                            href={encode_location(target_location)}
                            onClick={() => state.jump(target_location)} />
        );
    }

    const groups: ItemGroup<ManifestItem>[] = [
        {
            name: _("Apps"),
            items: current_machine_manifest_items.ordered("dashboard"),
        }, {
            name: _("System"),
            items: current_machine_manifest_items.ordered("menu"),
        }, {
            name: _("Tools"),
            items: current_machine_manifest_items.ordered("tools"),
        }
    ].filter(i => i.items.length > 0);

    if (current_machine_manifest_items.items.apps && groups.length === 3)
        groups[0].action = {
            label: _("Edit"),
            target: {
                host: current_machine.address,
                path: current_machine_manifest_items.items.apps.path,
            }
        };

    return <CockpitNav groups={groups}
                       selector="host-apps"
                       item_render={nav_item}
                       filtering={keyword_filter}
                       sorting={(a, b) => { return b.keyword.score - a.keyword.score }}
                       current={current_manifest_item.path}
                       jump={state.jump} />;
};
