import cockpit from "cockpit";

import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import {
    Button,
    Nav,
    SearchInput,
    Tooltip, TooltipPosition,
} from '@patternfly/react-core';
import { ContainerNodeIcon, ExclamationCircleIcon, ExclamationTriangleIcon, InfoCircleIcon } from '@patternfly/react-icons';

const _ = cockpit.gettext;

export const SidebarToggle = () => {
    const [active, setActive] = useState(false);

    useEffect(() => {
        /* This is a HACK for catching lost clicks on the pages which live in iframes so as to close dropdown menus on the shell.
         * Note: Clicks on an <iframe> element won't trigger document.documentElement listeners, because it's literally different page with different security domain.
         * However, when clicking on an iframe moves focus to its content's window that triggers the main window.blur event.
         * Addionally, when clicking on an element in the same iframe make sure to unset the 'active' state of the 'System' dropdown selector.
         */
        const handleClickOutside = (ev) => {
            if (ev.target.id == "nav-system-item")
                return;

            setActive(false);
        };

        ["blur", "click"].map(ev_type => window.addEventListener(ev_type, handleClickOutside));

        return () => {
            ["blur", "click"].map(ev_type => window.removeEventListener(ev_type, handleClickOutside));
        };
    }, []);

    useEffect(() => {
        document.getElementById("nav-system").classList.toggle("interact", active);
    }, [active]);

    return (
        <Button className={"pf-c-select__toggle ct-nav-toggle " + (active ? "active" : "")}
                id="nav-system-item" variant="plain"
                onClick={() => setActive(!active)}>
            <ContainerNodeIcon size="md" />
            {_("System")}
        </Button>
    );
};

export class CockpitNav extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            search: "",
            current: props.current,
        };

        this.clearSearch = this.clearSearch.bind(this);
    }

    componentDidMount() {
        const self = this;
        const sel = this.props.selector;
        // Click on active menu item (when using arrows to navigate through menu)
        function clickActiveItem() {
            const cur = document.activeElement;
            if (cur.nodeName === "INPUT") {
                const el = document.querySelector("#" + sel + " li:first-of-type a");
                if (el)
                    el.click();
            } else {
                cur.click();
            }
        }

        // Move focus to next item in menu (when using arrows to navigate through menu)
        // With arguments it is possible to change direction
        function focusNextItem(begin, step) {
            const cur = document.activeElement;
            const all = Array.from(document.querySelectorAll("#" + sel + " li a"));
            if (cur.nodeName === "INPUT" && all) {
                if (begin < 0)
                    begin = all.length - 1;
                all[begin].focus();
            } else {
                let i = all.findIndex(item => item === cur);
                i += step;
                if (i < 0 || i >= all.length)
                    document.querySelector("#" + sel + " .pf-c-text-input-group__text-input").focus();
                else
                    all[i].focus();
            }
        }

        function navigate_apps(ev) {
            if (ev.keyCode === 13) // Enter
                clickActiveItem();
            else if (ev.keyCode === 40) // Arrow Down
                focusNextItem(0, 1);
            else if (ev.keyCode === 38) // Arrow Up
                focusNextItem(-1, -1);
            else if (ev.keyCode === 27) { // Escape - clean selection
                self.setState({ search: "" });
                document.querySelector("#" + sel + " .pf-c-text-input-group__text-input").focus();
            }
        }

        document.getElementById(sel).addEventListener("keyup", navigate_apps);
        document.getElementById(sel).addEventListener("change", navigate_apps);
    }

    static getDerivedStateFromProps(nextProps, prevState) {
        if (nextProps.current !== prevState.current)
            return {
                current: nextProps.current,
                search: "",
            };
        return null;
    }

    clearSearch() {
        this.setState({ search: "" });
    }

    render() {
        const groups = [];
        const term = this.state.search.toLowerCase();
        this.props.groups.forEach(g => {
            const new_items = g.items.map(i => this.props.filtering(i, term)).filter(Boolean);
            new_items.sort(this.props.sorting);
            if (new_items.length > 0)
                groups.push({ name: g.name, items: new_items, action: g.action });
        });

        return (
            <>
                <SearchInput placeholder={_("Search")} value={this.state.search} onChange={(_, search) => this.setState({ search })} onClear={() => this.setState({ search: "" })} className="search" />
                <Nav onSelect={this.onSelect} theme="dark">
                    { groups.map(g =>
                        <section className="pf-c-nav__section" aria-labelledby={"section-title-" + g.name} key={g.name}>
                            <div className="nav-group-heading">
                                <h2 className="pf-c-nav__section-title" id={"section-title-" + g.name}>{g.name}</h2>
                                { g.action &&
                                    <a className="pf-c-nav__section-title nav-item" href={g.action.path} onClick={ ev => {
                                        this.props.jump(g.action.path);
                                        ev.preventDefault();
                                    }}>{g.action.label}</a>
                                }
                            </div>
                            <ul className="pf-c-nav__list">
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

CockpitNav.propTypes = {
    groups: PropTypes.array.isRequired,
    selector: PropTypes.string.isRequired,
    item_render: PropTypes.func.isRequired,
    current: PropTypes.string.isRequired,
    filtering: PropTypes.func.isRequired,
    sorting: PropTypes.func.isRequired,
    jump: PropTypes.func.isRequired,
};

function PageStatus({ status, name }) {
    // Generate name for the status
    let desc = name.toLowerCase().split(" ");
    desc.push(status.type);
    desc = desc.join("-");

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

function FormattedText({ keyword, term }) {
    function split_text(text, term) {
        const b = text.toLowerCase().indexOf(term);
        const e = b + term.length;
        return [text.substring(0, b), text.substring(b, e), text.substring(e, text.length)];
    }

    const s = split_text(keyword, term);
    return (
        <>{s[0]}<mark>{s[1]}</mark>{s[2]}</>
    );
}

export function CockpitNavItem(props) {
    const s = props.status;
    const name_matches = props.keyword === props.name.toLowerCase();
    let header_matches = false;
    if (props.header)
        header_matches = props.keyword === props.header.toLowerCase();

    const classes = props.className ? [props.className] : [];
    classes.push("pf-c-nav__item", "nav-item");

    return (
        <li className={classes.join(" ")}>
            <a className={"pf-c-nav__link" + (props.active ? " pf-m-current" : "")}
                aria-current={props.active && "page"}
                href={cockpit.location.encode(props.to, {}, true)} onClick={ev => {
                    props.jump(props.to);
                    ev.preventDefault();
                }}>
                { props.header && <span className="nav-item-hint">{header_matches ? <FormattedText keyword={props.header} term={props.term} /> : props.header}</span> }
                <span className="nav-item-name">
                    { name_matches ? <FormattedText keyword={props.name} term={props.term} /> : props.name }
                </span>
                {s && s.type && <PageStatus status={s} name={props.name} />}
                { !name_matches && !header_matches && props.keyword && <span className="nav-item-hint nav-item-hint-contains">{_("Contains:")} <FormattedText keyword={props.keyword} term={props.term} /></span> }
            </a>
            <span className="nav-item-actions nav-host-action-buttons">
                {props.actions}
            </span>
        </li>
    );
}

CockpitNavItem.propTypes = {
    name: PropTypes.string.isRequired,
    to: PropTypes.string.isRequired,
    jump: PropTypes.func,
    status: PropTypes.object,
    active: PropTypes.bool,
    keyword: PropTypes.string,
    term: PropTypes.string,
    header: PropTypes.string,
    actions: PropTypes.node,
};
