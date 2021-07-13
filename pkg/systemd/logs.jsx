/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import '../lib/patternfly/patternfly-cockpit.scss';

import cockpit from "cockpit";
import React, { useState, useEffect } from 'react';
import ReactDOM from "react-dom";

import {
    Button,
    ClipboardCopy,
    Divider,
    Flex, FlexItem,
    List, ListItem,
    Page, PageSection, PageSectionVariants,
    Popover,
    SearchInput,
    Select, SelectOption, SelectVariant,
    Toolbar, ToolbarContent, ToolbarItem, ToolbarToggleGroup,
} from "@patternfly/react-core";
import {
    ExternalLinkSquareAltIcon,
    FilterIcon,
    HelpIcon,
} from '@patternfly/react-icons';

import {
    checkJournalctlGrep,
    getGrepFiltersFromOptions,
    getOptionsFromTextInput,
} from "./logsHelpers.js";
import { JournalBox } from "./logsJournal.jsx";
import { LogEntry } from "./logDetails.jsx";

import { usePageLocation } from "hooks";

const _ = cockpit.gettext;

const timeFilterOptions = [
    { key: "boot", value: 0, toString: () => _("Current boot"), },
    { key: "boot", value: "-1", toString: () => _("Previous boot") },
    { key: "since", value: "-24hours", toString: () => _("Last 24 hours") },
    { key: "since", value: "-7days", toString: () => _("Last 7 days") },
];

const journalPrioOptions = [
    { value: "emerg", toString: () => _("Only emergency") },
    { value: "alert", toString: () => _("Alert and above") },
    { value: "crit", toString: () => _("Critical and above") },
    { value: "err", toString: () => _("Error and above") },
    { value: "warning", toString: () => _("Warning and above") },
    { value: "notice", toString: () => _("Notice and above") },
    { value: "info", toString: () => _("Info and above") },
    { value: "debug", toString: () => _("Debug and above") },
];

const getPrioFilterOption = options => {
    if (options.priority || options.prio)
        return journalPrioOptions.find(option => option.value == options.priority || option.value == options.prio);

    return journalPrioOptions.find(option => option.value == "err");
};

const getTimeFilterOption = options => {
    if (options.boot)
        return timeFilterOptions.find(option => option.key == 'boot' && option.value == options.boot);
    else if (options.since)
        return timeFilterOptions.find(option => option.key == 'since' && option.value == options.since);
    else
        return undefined;
};

export const LogsPage = () => {
    const { path, options } = usePageLocation();
    let follow = !(options.follow && options.follow === "false");

    if (options.boot && options.boot !== "0") // Don't follow if specific boot is picked
        follow = false;

    const full_grep = getGrepFiltersFromOptions({ options })[0];

    /* Initial state */
    const [currentServices, setCurrentServices] = useState(undefined);
    const [dataFollowing, setDataFollowing] = useState(follow);
    const [filteredQuery, setFilteredQuery] = useState(undefined);
    const [isOpenPrioFilter, setIsOpenPrioFilter] = useState(false);
    const [isOpenTimeFilter, setIsOpenTimeFilter] = useState(false);
    // `prio` is a legacy name. Accept it, but don't generate it
    const [journalPrio, setJournalPrio] = useState(getPrioFilterOption(options));
    const [servicesFilter, setServicesFilter] = useState(options.tag || _("All"));
    const [showTextSearch, setShowTextSearch] = useState(false);
    const [textFilter, setTextFilter] = useState(full_grep);
    const [timeFilter, setTimeFilter] = useState(getTimeFilterOption(options));
    const [updateServicesList, setUpdateServicesList] = useState(true);

    useEffect(() => {
        checkJournalctlGrep(setShowTextSearch);

        function onNavigate() {
            const { options, path } = cockpit.location;
            const full_grep = getGrepFiltersFromOptions({ options })[0];

            if (path.length == 1) return;

            setJournalPrio(getPrioFilterOption(options));
            setServicesFilter(options.tag || _("All"));
            setTextFilter(full_grep);
            setTimeFilter(getTimeFilterOption(options));
        }

        cockpit.addEventListener("locationchanged", onNavigate);
        return () => cockpit.removeEventListener("locationchanged", onNavigate);
    }, []);

    if (path.length == 1) {
        return <LogEntry />;
    } else if (path.length > 1) { /* redirect */
        console.warn("not a journal location: " + path);
        cockpit.location = '';
    }

    const updateUrl = (options) => {
        cockpit.location.go([], options);
    };

    const onJournalPrioChange = (value) => {
        setUpdateServicesList(true);

        updateUrl(Object.assign(options, { priority: value }));
    };

    const onServicesFilterChange = (value) => {
        setUpdateServicesList(false);

        if (value == _("All")) {
            delete options.tag;
            updateUrl(Object.assign(options));
        } else {
            updateUrl(Object.assign(options, { tag: value }));
        }
    };

    const onTextFilterChange = (value) => {
        setUpdateServicesList(true);

        updateUrl(Object.assign(getOptionsFromTextInput(value)));
    };

    const onTimeFilterChange = (newTimeFilter) => {
        setUpdateServicesList(true);

        if (newTimeFilter.key == 'boot' && newTimeFilter.value !== "0") // Don't follow if specific boot is picked
            setDataFollowing(false);
        else if (options.boot && options.boot !== "0" && newTimeFilter.key !== "boot") // Start following is specific boot is removed
            setDataFollowing(true);

        // Remove all parameters which can be set up using filters
        delete options.boot;
        delete options.since;

        cockpit.location.go([], Object.assign(options, { [newTimeFilter.key]: newTimeFilter.value }));
    };

    return (
        <Page>
            <PageSection id="journal" padding={{ default: 'noPadding' }}>
                <Toolbar>
                    <ToolbarContent>
                        <ToolbarToggleGroup toggleIcon={<FilterIcon />} breakpoint="lg">
                            <ToolbarItem>
                                <Select toggleId="logs-predefined-filters"
                                        isOpen={isOpenTimeFilter}
                                        onToggle={setIsOpenTimeFilter}
                                        onSelect={(e, selection) => {
                                            setIsOpenTimeFilter(false);
                                            onTimeFilterChange(selection);
                                        }}
                                        selections={timeFilter}
                                        placeholderText={_("Time")}>
                                    {timeFilterOptions.map(option => <SelectOption key={option.value}
                                                                                   value={option} />)}
                                </Select>
                            </ToolbarItem>

                            <ToolbarItem variant="label">
                                {_("Priority")}
                            </ToolbarItem>
                            <ToolbarItem>
                                <Select toggleId="journal-prio-menu"
                                        isOpen={isOpenPrioFilter}
                                        onToggle={setIsOpenPrioFilter}
                                        onSelect={(e, selection) => {
                                            setIsOpenPrioFilter(false);
                                            onJournalPrioChange(selection.value);
                                        }}
                                        selections={journalPrio}>
                                    {journalPrioOptions.map(option => <SelectOption key={option.value} value={option} />)}
                                </Select>
                            </ToolbarItem>
                            <ToolbarItem variant="label">
                                {_("Identifier")}
                            </ToolbarItem>
                            <ToolbarItem id="journal-service-menu">
                                <ServicesFilter currentServices={currentServices}
                                                onServicesFilterChange={onServicesFilterChange}
                                                servicesFilter={servicesFilter} />
                            </ToolbarItem>

                            {showTextSearch &&
                            <>
                                <ToolbarItem variant="label">
                                    {_("Text")}
                                </ToolbarItem>
                                <ToolbarItem className="text-search">
                                    <TextFilter id="journal-grep"
                                                key={textFilter}
                                                textFilter={textFilter} onTextFilterChange={onTextFilterChange} />
                                </ToolbarItem>
                                <ToolbarItem className="text-help">
                                    <Popover id="logs-help-popover"
                                             hasAutoWidth
                                             bodyContent={
                                                 <div className="logs-help-menu">
                                                     <span>{_("Search the logs with a combination of terms:")}</span>
                                                     <List>
                                                         <ListItem><span>{_("qualifiers")}</span>, <span>{_("e.g.")}</span> 'priority:', 'identifier:', 'service:'</ListItem>
                                                         <ListItem><span>{_("log fields")}</span>, <span>{_("e.g")}.</span> '_EXE=/usr/bin/python'</ListItem>
                                                         <ListItem>{_("any free-form string as regular expression")}</ListItem>
                                                     </List>
                                                     <span className="help-links">
                                                         <Button variant="link" component="a"
                                                                 href="https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/managing_systems_using_the_rhel_8_web_console/reviewing-logs_system-management-using-the-rhel-8-web-console#filtering-logs-in-the-web-console_reviewing-logs"
                                                                 icon={<ExternalLinkSquareAltIcon />}
                                                                 iconPosition="right"
                                                                 target="blank" rel="noopener noreferrer">
                                                             {_("Learn more")}
                                                         </Button>
                                                         <Button variant="link" component="a"
                                                                 href="https://www.freedesktop.org/software/systemd/man/journalctl.html"
                                                                 icon={<ExternalLinkSquareAltIcon />} iconPosition="right"
                                                                 target="blank" rel="noopener noreferrer">
                                                             journalctl manpage
                                                         </Button>
                                                     </span>
                                                     <ClipboardCopy clickTip={_("Successfully copied to keyboard")}
                                                                    hoverTip={_("Copy to clipboard")}
                                                                    id="journal-cmd-copy"
                                                                    isCode>
                                                         {filteredQuery}
                                                     </ClipboardCopy>
                                                 </div>
                                             }>
                                        <HelpIcon id="logs-help-toggle" />
                                    </Popover>
                                </ToolbarItem>
                            </>}
                        </ToolbarToggleGroup>
                        <ToolbarItem variant="separator" />

                        <ToolbarItem>
                            <Button id="journal-follow"
                                        variant="secondary"
                                        isDisabled={options.boot && options.boot !== "0"}
                                        onClick={() => {
                                            // Reset time filter if following mode is now selected but we are on a specific boot
                                            if (!dataFollowing && timeFilter && timeFilter.key == "boot" && timeFilter.value !== "0") {
                                                setTimeFilter(undefined);
                                            }

                                            setDataFollowing(!dataFollowing);
                                        }
                                        }
                                        data-following={dataFollowing}>
                                {dataFollowing ? _("Pause") : _("Resume")}
                            </Button>
                        </ToolbarItem>
                    </ToolbarContent>
                </Toolbar>

            </PageSection>
            <PageSection padding={{ default: 'noPadding' }}
                         variant={PageSectionVariants.light}
                         id="journal-box">
                <JournalBox dataFollowing={dataFollowing}
                            setCurrentServices={setCurrentServices}
                            setFilteredQuery={setFilteredQuery}
                            updateServicesList={updateServicesList}
                            setUpdateServicesList={setUpdateServicesList} />
            </PageSection>
        </Page>
    );
};

const ServicesFilter = ({ servicesFilter, onServicesFilterChange, currentServices }) => {
    const [isOpenServicesFilter, setIsOpenServicesFilter] = useState(false);

    let servicesArray;
    if (currentServices !== undefined) {
        servicesArray = [
            <SelectOption key="all" value={_("All")} />,
            <Divider component="li" key="divider" />
        ];
        servicesArray = servicesArray.concat(
            Array.from(currentServices)
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                    .map(unit => <SelectOption key={unit} value={unit} />)
        );
    } else {
        servicesArray = [
            <SelectOption key={servicesFilter} value={servicesFilter} isDisabled />
        ];
    }

    /* The noResultsFoundText is not shown because of https://github.com/patternfly/patternfly-react/issues/6005 */
    return (
        <Select {...(currentServices === undefined && { loadingVariant: 'spinner' })}
                onToggle={setIsOpenServicesFilter}
                onSelect={(e, selection) => {
                    setIsOpenServicesFilter(false);
                    onServicesFilterChange(selection);
                }}
                isOpen={isOpenServicesFilter}
                noResultsFoundText={_("No results found")}
                onClear={() => {
                    setIsOpenServicesFilter(false);
                    onServicesFilterChange(_("All"));
                }}
                selections={servicesFilter}
                typeAheadAriaLabel={_("Select a service")}
                variant={SelectVariant.typeahead}>
            {servicesArray}
        </Select>
    );
};

const TextFilter = ({ textFilter, onTextFilterChange }) => {
    const [unsubmittedTextFilter, setUnsubmittedTextFilter] = useState(textFilter);
    const sinceUntilBody = _("Date specifications should be of the format YYYY-MM-DD hh:mm:ss. Alternatively the strings 'yesterday', 'today', 'tomorrow' are understood. 'now' refers to the current time. Finally, relative times may be specified, prefixed with '-' or '+'");
    const sinceLabel = (
        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>{_("Since")}</FlexItem>
            <Popover headerContent={_("Start showing entries on or newer than the specified date.")}
                     showClose={false}
                     bodyContent={sinceUntilBody}>
                <HelpIcon />
            </Popover>
        </Flex>
    );
    const untilLabel = (
        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>{_("Until")}</FlexItem>
            <Popover headerContent={_("Start showing entries on or older than the specified date.")}
                     showClose={false}
                     bodyContent={sinceUntilBody}>
                <HelpIcon />
            </Popover>
        </Flex>
    );
    const bootLabel = (
        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>{_("Boot")}</FlexItem>
            <Popover headerContent={_("Show messages from a specific boot.")}
                     showClose={false}
                     bodyContent={_("This will add a match for '_BOOT_ID='. If not specified the logs for the current boot will be shown. If the boot ID is omitted, a positive offset will look up the boots starting from the beginning of the journal, and an equal-or-less-than zero offset will look up boots starting from the end of the journal. Thus, 1 means the first boot found in the journal in chronological order, 2 the second and so on; while -0 is the last boot, -1 the boot before last, and so on.")}>
                <HelpIcon />
            </Popover>
        </Flex>
    );
    const searchInputAttributes = [
        { attr: "since", display: sinceLabel },
        { attr: "until", display: untilLabel },
        { attr: "boot", display: bootLabel },
        { attr: "priority" }, // Hide this with CSS
        { attr: "tag" }, // Hide this with CSS
    ];

    return (
        <SearchInput attributes={searchInputAttributes}
                     hasWordsAttrLabel={_("Regular expression match")}
                     advancedSearchDelimiter=":"
                     id="journal-grep"
                     onClear={() => { onTextFilterChange(""); setUnsubmittedTextFilter("") }}
                     placeholder={_("Type to filter")}
                     value={unsubmittedTextFilter}
                     onChange={setUnsubmittedTextFilter}
                     onSearch={() => onTextFilterChange(unsubmittedTextFilter)} />
    );
};

function init() {
    ReactDOM.render(<LogsPage />, document.getElementById("logs"));
}

document.addEventListener("DOMContentLoaded", init);
