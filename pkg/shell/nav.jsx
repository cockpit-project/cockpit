import cockpit from "cockpit";

import React from 'react';
import PropTypes from 'prop-types';

import {
    Nav,
} from '@patternfly/react-core';
import { ExclamationCircleIcon, ExclamationTriangleIcon, InfoCircleIcon } from '@patternfly/react-icons';
import { OverlayTrigger, Tooltip } from 'patternfly-react';

const _ = cockpit.gettext;

export class CockpitNav extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            search: "",
            current: props.current,
        };

        this.onSearchChanged = this.onSearchChanged.bind(this);
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
                    document.querySelector("#" + sel + " .filter-menus").focus();
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
                document.querySelector("#" + sel + " .filter-menus").focus();
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

    onSearchChanged(e) {
        this.setState({ search: e.target.value });
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
                <div className="has-feedback search">
                    <input className="filter-menus form-control" type="search" placeholder={_("Search")} aria-label={_("Search")} onChange={this.onSearchChanged} value={this.state.search} />
                    <span className="fa fa-search form-control-feedback" />
                </div>
                <Nav onSelect={this.onSelect} theme="dark">
                    { groups.map(g =>
                        <section className="pf-c-nav__section" aria-labelledby={"section-title-" + g.name} key={g.name}>
                            <div className="nav-group-heading">
                                <h2 className="pf-c-nav__section-title" id={"section-title-" + g.name}>{g.name}</h2>
                                { g.action &&
                                    <a className="pf-c-nav__section-title nav-item" href={g.action.path}>{g.action.label}</a>
                                }
                            </div>
                            <ul className="pf-c-nav__list">
                                {g.items.map(i => this.props.item_render(i, this.state.search.toLowerCase()))}
                            </ul>
                        </section>
                    )}
                    { groups.length < 1 && <span className="non-menu-item">{_("No results found")}</span> }
                    { this.state.search !== "" && <span className="non-menu-item"><button onClick={this.clearSearch} className="link-button hint">{_("Clear Search")}</button></span> }
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
};

function PageStatus({ status, name }) {
    // Generate name for the status
    let desc = name.toLowerCase().split(" ");
    desc.push(status.type);
    desc = desc.join("-");

    return (
        <OverlayTrigger placement="right" overlay={ <Tooltip id={desc + "-tooltip"}>{ status.title }</Tooltip> }>
            <span id={desc} className="nav-status">
                {status.type == "error" ? <ExclamationCircleIcon color="#f54f42" />
                    : status.type == "warning" ? <ExclamationTriangleIcon color="#f0ab00" />
                        : <InfoCircleIcon color="#73bcf7" />}
            </span>
        </OverlayTrigger>
    );
}

function FormatedText({ keyword, term }) {
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

    // Buttons when disabled don't get any events, but the events go to their parents
    // This is problematic when there are disabled buttons over elements that have event listeners
    // In our case it is navigation item with possible actions (like editing of host)
    function event_eater(ev) {
        if (ev) {
            ev.stopPropagation();
            ev.preventDefault();
        }
    }

    const classes = props.className ? [props.className] : [];
    classes.push("pf-c-nav__item", "nav-item");

    return (
        <li className={classes.join(" ")}>
            <span className={"pf-c-nav__link" + (props.active ? " pf-m-current" : "")} data-for={props.to}>
                <a href={props.to}>
                    { props.header && <span className="hint">{header_matches ? <FormatedText keyword={props.header} term={props.term} /> : props.header}</span> }
                    { name_matches ? <FormatedText keyword={props.name} term={props.term} /> : props.name }
                    { !name_matches && !header_matches && props.keyword && <span className="hint">{_("Contains:")} <FormatedText keyword={props.keyword} term={props.term} /></span> }
                </a>
                {s && s.type && <PageStatus status={s} name={props.name} />}
                { props.actions &&
                    <div role="presentation" className="nav-host-action-buttons event-eater" onClick={event_eater} onKeyPress={event_eater}>
                        {props.actions}
                    </div>
                }
            </span>
        </li>
    );
}

CockpitNavItem.propTypes = {
    name: PropTypes.string.isRequired,
    to: PropTypes.string.isRequired,
    status: PropTypes.object,
    active: PropTypes.bool,
    keyword: PropTypes.string,
    term: PropTypes.string,
    header: PropTypes.string,
    actions: PropTypes.array,
};
