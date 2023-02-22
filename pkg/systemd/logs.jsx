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

import '../lib/patternfly/patternfly-4-cockpit.scss';
import 'cockpit-dark-theme'; // once per page

import cockpit from "cockpit";
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Select, SelectOption, SelectVariant } from "@patternfly/react-core/dist/esm/components/Select/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Toolbar, ToolbarContent, ToolbarGroup, ToolbarItem, ToolbarToggleGroup } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
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
    { key: "since", value: "-24hours", toString: () => _("Last 24 hours"), default: true },
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
    return timeFilterOptions.find(option => 'default' in option); // Use the default key
};

export const LogsPage = () => {
    const { path, options } = usePageLocation();
    let follow = !(options.follow && options.follow === "false");

    if (options.boot && options.boot !== "0") // Don't follow if specific boot is picked
        follow = false;

    // If priority not specified use err
    if (!options.priority && !options.prio)
        options.priority = 'err';

    const full_grep = getGrepFiltersFromOptions({ options })[0];

    /* Initial state */
    const [currentIdentifiers, setCurrentIdentifiers] = useState(undefined);
    const [dataFollowing, setDataFollowing] = useState(follow);
    const [filteredQuery, setFilteredQuery] = useState(undefined);
    const [isOpenPrioFilter, setIsOpenPrioFilter] = useState(false);
    const [isOpenTimeFilter, setIsOpenTimeFilter] = useState(false);
    // `prio` is a legacy name. Accept it, but don't generate it
    const [journalPrio, setJournalPrio] = useState(getPrioFilterOption(options));
    const [identifiersFilter, setIdentifiersFilter] = useState(options.tag || _("All"));
    const [showTextSearch, setShowTextSearch] = useState(false);
    const [textFilter, setTextFilter] = useState(full_grep);
    const [timeFilter, setTimeFilter] = useState(getTimeFilterOption(options));
    const [updateIdentifiersList, setUpdateIdentifiersList] = useState(true);

    useEffect(() => {
        checkJournalctlGrep(setShowTextSearch);

        function onNavigate() {
            const { options, path } = cockpit.location;
            const full_grep = getGrepFiltersFromOptions({ options })[0];

            if (path.length == 1) return;

            setJournalPrio(getPrioFilterOption(options));
            setIdentifiersFilter(options.tag || _("All"));
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
        setUpdateIdentifiersList(false);

        updateUrl(Object.assign(options, { priority: value }));
    };

    const onIdentifiersFilterChange = (value) => {
        setUpdateIdentifiersList(false);

        if (value == _("All")) {
            delete options.tag;
            updateUrl(Object.assign(options));
        } else {
            updateUrl(Object.assign(options, { tag: value }));
        }
    };

    const onTextFilterChange = (value) => {
        setUpdateIdentifiersList(true);

        updateUrl(Object.assign(getOptionsFromTextInput(value)));
    };

    const onTimeFilterChange = (newTimeFilter) => {
        setUpdateIdentifiersList(true);

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
                        <ToolbarToggleGroup className="pf-u-flex-wrap pf-u-flex-grow-1" toggleIcon={<><span className="pf-c-button__icon pf-m-start"><FilterIcon /></span>{_("Toggle filters")}</>} breakpoint="md">
                            <ToolbarGroup>
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
                                <ToolbarItem id="journal-identifier-menu">
                                    <IdentifiersFilter currentIdentifiers={currentIdentifiers}
                                                    onIdentifiersFilterChange={onIdentifiersFilterChange}
                                                    identifiersFilter={identifiersFilter} />
                                </ToolbarItem>
                            </ToolbarGroup>

                            <ToolbarGroup>
                                {showTextSearch &&
                                <>
                                    <ToolbarItem variant="label">
                                        {_("Filters")}
                                    </ToolbarItem>
                                    <ToolbarItem className="text-search">
                                        <TextFilter id="journal-grep"
                                                    key={textFilter}
                                                    textFilter={textFilter}
                                                    onTextFilterChange={onTextFilterChange}
                                                    filteredQuery={filteredQuery} />
                                    </ToolbarItem>
                                </>}
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
                            </ToolbarGroup>
                        </ToolbarToggleGroup>
                    </ToolbarContent>
                </Toolbar>

            </PageSection>
            <PageSection padding={{ default: 'noPadding' }}
                         variant={PageSectionVariants.light}
                         id="journal-box">
                <JournalBox dataFollowing={dataFollowing}
                            defaultSince={timeFilter ? timeFilter.value : getTimeFilterOption({}).value}
                            setCurrentIdentifiers={setCurrentIdentifiers}
                            setFilteredQuery={setFilteredQuery}
                            updateIdentifiersList={updateIdentifiersList}
                            setUpdateIdentifiersList={setUpdateIdentifiersList} />
            </PageSection>
        </Page>
    );
};

const IdentifiersFilter = ({ identifiersFilter, onIdentifiersFilterChange, currentIdentifiers }) => {
    const [isOpenIdentifiersFilter, setIsOpenIdentifiersFilter] = useState(false);

    let identifiersArray;
    if (currentIdentifiers !== undefined) {
        identifiersArray = [
            <SelectOption key="all" value={_("All")} />,
            <Divider component="li" key="divider" />
        ];
        identifiersArray = identifiersArray.concat(
            Array.from(currentIdentifiers)
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                    .map(unit => <SelectOption key={unit} value={unit} />)
        );
    } else {
        identifiersArray = [
            <SelectOption key={identifiersFilter} value={identifiersFilter} isDisabled />
        ];
    }

    /* The noResultsFoundText is not shown because of https://github.com/patternfly/patternfly-react/issues/6005 */
    return (
        <Select {...(currentIdentifiers === undefined && { loadingVariant: 'spinner' })}
                onToggle={setIsOpenIdentifiersFilter}
                onSelect={(e, selection) => {
                    setIsOpenIdentifiersFilter(false);
                    onIdentifiersFilterChange(selection);
                }}
                isOpen={isOpenIdentifiersFilter}
                noResultsFoundText={_("No results found")}
                onClear={() => {
                    setIsOpenIdentifiersFilter(false);
                    onIdentifiersFilterChange(_("All"));
                }}
                selections={identifiersFilter}
                typeAheadAriaLabel={_("Select a identifier")}
                variant={SelectVariant.typeahead}>
            {identifiersArray}
        </Select>
    );
};

const TextFilter = ({ textFilter, onTextFilterChange, filteredQuery }) => {
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

    const serviceLabel = (
        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>{_("Unit")}</FlexItem>
            <Popover headerContent={_("Show messages for the specified systemd unit.")}
                     showClose={false}
                     bodyContent={_("This will add match for '_SYSTEMD_UNIT=', 'COREDUMP_UNIT=' and 'UNIT=' to find all possible messages for the given unit. Can contain more units separated by comma. ")}>
                <HelpIcon />
            </Popover>
        </Flex>
    );

    const freeTextLabel = (
        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>{_("Free-form search")}</FlexItem>
            <Popover headerContent={_("Show messages containing given string.")}
                     showClose={false}
                     bodyContent={_("Any text string in the logs messages can be filtered. The string can also be in the form of a regular expression. Also supports filtering by message log fields. These are space separated values, in form FIELD=VALUE, where value can be comma separated list of possible values.")}>
                <HelpIcon />
            </Popover>
        </Flex>
    );

    const searchInputAttributes = [
        { attr: "since", display: sinceLabel },
        { attr: "until", display: untilLabel },
        { attr: "boot", display: bootLabel },
        { attr: "unit", display: serviceLabel },
        { attr: "priority" }, // Hide this with CSS
        { attr: "tag" }, // Hide this with CSS
    ];

    return (
        <SearchInput attributes={searchInputAttributes}
                     hasWordsAttrLabel={freeTextLabel}
                     advancedSearchDelimiter=":"
                     id="journal-grep"
                     onClear={() => { onTextFilterChange(""); setUnsubmittedTextFilter("") }}
                     placeholder={_("Type to filter")}
                     value={unsubmittedTextFilter}
                     onChange={(_, val) => setUnsubmittedTextFilter(val)}
                     resetButtonLabel={_("Reset")}
                     submitSearchButtonLabel={_("Search")}
                     formAdditionalItems={<Stack hasGutter>
                         <Button variant="link" component="a" isInline
                                     href="https://www.freedesktop.org/software/systemd/man/journalctl.html"
                                     icon={<ExternalLinkSquareAltIcon />} iconPosition="right"
                                     target="blank" rel="noopener noreferrer">
                             {_("journalctl manpage")}
                         </Button>
                         <ClipboardCopy clickTip={_("Successfully copied to clipboard")}
                                            isReadOnly
                                            hoverTip={_("Copy to clipboard")}
                                            id="journal-cmd-copy"
                                            isCode>
                             {filteredQuery}
                         </ClipboardCopy>
                     </Stack>}
                     onSearch={() => onTextFilterChange(unsubmittedTextFilter)} />
    );
};

function init() {
    const root = createRoot(document.getElementById('logs'));
    root.render(<LogsPage />);
}

document.addEventListener("DOMContentLoaded", init);
