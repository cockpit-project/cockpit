/*

MIT License

Copyright (c) 2019 Red Hat, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

/* This is a copy of MultiTypeaheadSelect.tsx from

       https://github.com/patternfly/patternfly-react/blob/v5/packages/react-templates/src/components/Select/MultiTypeaheadSelect.tsx

   We don't use it directly from the @patternfly/react-templates node
   module since we want to add features to it, and also to isolate us
   from gratuitous upstream changes.

   Our changes:

   - The selection is controlled from the outside and not maintained
     as internal state. This is how things should work with React.

   - Changes are announced via incremental onAdd and onRemove
     handlers.

   - We use Labels instead of Chips, since we want colors.

   - The clear button clears the input text, not the selection.

*/

/* eslint-disable */

import cockpit from "cockpit";
import React from 'react';
import {
  Select,
  SelectOption,
  SelectList,
  SelectOptionProps,
  MenuToggle,
  MenuToggleElement,
  TextInputGroup,
  TextInputGroupMain,
  TextInputGroupUtilities,
  Button,
  MenuToggleProps,
  SelectProps,
} from '@patternfly/react-core';
import { Label, LabelGroup, LabelProps } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import TimesIcon from '@patternfly/react-icons/dist/esm/icons/times-icon';

const _ = cockpit.gettext;

export interface MultiTypeaheadSelectOption extends Omit<SelectOptionProps, 'content' | 'isSelected'> {
  /** Content of the select option. */
  content: string | number;
  /** Value of the select option. */
  value: string | number;
  /** Color */
  color?: LabelProps["color"];
}

export interface MultiTypeaheadSelectProps extends Omit<SelectProps, 'toggle' | 'onSelect'> {
  /** @hide Forwarded ref */
  innerRef?: React.Ref<any>;
  /** Options of the select. */
  options: MultiTypeaheadSelectOption[];
  /** Selected values */
  selected: (string | number)[];
  /** Callback triggered when an option is added. */
  onAdd: (value: (string | number)) => void;
  /** Callback triggered wehn an option is removed. */
  onRemove: (value: (string | number)) => void;
  /** Callback triggered when the select opens or closes. */
  onToggle?: (nextIsOpen: boolean) => void;
  /** Callback triggered when the text in the input field changes. */
  onInputChange?: (newValue: string) => void;
  /** Placeholder text for the select input. */
  placeholder?: string;
  /** Message to display when no options match the filter. */
  noOptionsFoundMessage?: string | ((filter: string) => string);
  /** Flag indicating the select should be disabled. */
  isDisabled?: boolean;
  /** Width of the toggle. */
  toggleWidth?: string;
  /** Additional props passed to the toggle. */
  toggleProps?: MenuToggleProps;
}

export const MultiTypeaheadSelectBase: React.FunctionComponent<MultiTypeaheadSelectProps> = ({
  innerRef,
  options,
  selected,
  onAdd,
  onRemove,
  onToggle,
  onInputChange,
  placeholder = '',
  noOptionsFoundMessage = _filter => _("No results found"),
  isDisabled = false,
  toggleWidth,
  toggleProps,
  ...props
}: MultiTypeaheadSelectProps) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState<string>("");
  const [selectOptions, setSelectOptions] = React.useState<MultiTypeaheadSelectOption[]>(options);
  const [focusedItemIndex, setFocusedItemIndex] = React.useState<number | null>(null);
  const [activeItemId, setActiveItemId] = React.useState<string | null>(null);
  const textInputRef = React.useRef<HTMLInputElement>();

  const NO_RESULTS = 'no results';

  const openMenu = () => {
    onToggle && onToggle(true);
    setIsOpen(true);
  };

  React.useEffect(() => {
    let newSelectOptions: MultiTypeaheadSelectOption[] = options;

    // Filter menu items based on the text input value when one exists
    if (inputValue) {
      newSelectOptions = options.filter((option) =>
        String(option.content).toLowerCase().includes(inputValue.toLowerCase())
      );

      // When no options are found after filtering, display 'No results found'
      if (!newSelectOptions.length) {
        newSelectOptions = [
          {
            isAriaDisabled: true,
            content:
              typeof noOptionsFoundMessage === 'string' ? noOptionsFoundMessage : noOptionsFoundMessage(inputValue),
            value: NO_RESULTS
          }
        ];
      }

      // Open the menu when the input value changes and the new value is not empty
      openMenu();
    }

    setSelectOptions(newSelectOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, options]);

  const setActiveAndFocusedItem = (itemIndex: number) => {
    setFocusedItemIndex(itemIndex);
    const focusedItem = selectOptions[itemIndex];
    setActiveItemId(focusedItem.value as string);
  };

  const resetActiveAndFocusedItem = () => {
    setFocusedItemIndex(null);
    setActiveItemId(null);
  };

  const closeMenu = () => {
    onToggle && onToggle(false);
    setIsOpen(false);
    resetActiveAndFocusedItem();
    setInputValue('');
  };

  const onInputClick = () => {
    if (!isOpen) {
      openMenu();
    } else if (!inputValue) {
      closeMenu();
    }
  };

  const selectOption = (option: string | number) => {
    if (selected.includes(option))
      onRemove(option);
    else
      onAdd(option);
  };

  const _onSelect = (_event: React.MouseEvent<Element, MouseEvent> | undefined, value: string | number | undefined) => {
    if (value && value !== NO_RESULTS) {
      selectOption(value);
      closeMenu();
    }
  };

  const onTextInputChange = (_event: React.FormEvent<HTMLInputElement>, value: string) => {
    setInputValue(value);
    onInputChange && onInputChange(value);

    resetActiveAndFocusedItem();
  };

  const handleMenuArrowKeys = (key: string) => {
    let indexToFocus = 0;

    if (!isOpen) {
      openMenu();
    }

    if (selectOptions.every((option) => option.isDisabled)) {
      return;
    }

    if (key === 'ArrowUp') {
      // When no index is set or at the first index, focus to the last, otherwise decrement focus index
      if (focusedItemIndex === null || focusedItemIndex === 0) {
        indexToFocus = selectOptions.length - 1;
      } else {
        indexToFocus = focusedItemIndex - 1;
      }

      // Skip disabled options
      while (selectOptions[indexToFocus].isDisabled) {
        indexToFocus--;
        if (indexToFocus === -1) {
          indexToFocus = selectOptions.length - 1;
        }
      }
    }

    if (key === 'ArrowDown') {
      // When no index is set or at the last index, focus to the first, otherwise increment focus index
      if (focusedItemIndex === null || focusedItemIndex === selectOptions.length - 1) {
        indexToFocus = 0;
      } else {
        indexToFocus = focusedItemIndex + 1;
      }

      // Skip disabled options
      while (selectOptions[indexToFocus].isDisabled) {
        indexToFocus++;
        if (indexToFocus === selectOptions.length) {
          indexToFocus = 0;
        }
      }
    }

    setActiveAndFocusedItem(indexToFocus);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const focusedItem = focusedItemIndex !== null ? selectOptions[focusedItemIndex] : null;

    switch (event.key) {
      case 'Enter':
        if (isOpen && focusedItem && focusedItem.value !== NO_RESULTS && !focusedItem.isAriaDisabled) {
          selectOption(focusedItem?.value);
        }

        if (!isOpen) {
          onToggle && onToggle(true);
          setIsOpen(true);
        }

        break;
      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault();
        handleMenuArrowKeys(event.key);
        break;
    }
  };

  const onToggleClick = () => {
    onToggle && onToggle(!isOpen);
    setIsOpen(!isOpen);
    textInputRef?.current?.focus();
  };

  const onClearButtonClick = (_ev: React.MouseEvent) => {
    setInputValue('');
    onInputChange && onInputChange('');
    resetActiveAndFocusedItem();
    textInputRef?.current?.focus();
  };

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      variant="typeahead"
      onClick={onToggleClick}
      isExpanded={isOpen}
      isDisabled={isDisabled}
      isFullWidth
      style={
        {
          width: toggleWidth
        } as React.CSSProperties
      }
      {...toggleProps}
    >
      <TextInputGroup isPlain>
        <TextInputGroupMain
          value={inputValue}
          onClick={onInputClick}
          onChange={onTextInputChange}
          onKeyDown={onInputKeyDown}
          autoComplete="off"
          innerRef={textInputRef}
          placeholder={placeholder}
          {...(activeItemId && { 'aria-activedescendant': activeItemId })}
          role="combobox"
          isExpanded={isOpen}
          aria-controls="select-typeahead-listbox"
        >
            <LabelGroup numLabels={10}>
                {selected.map((selection) => {
                    const option = options.find((o) => o.value === selection);
                    if (!option)
                        return null;
                    const { content, color } = option;
                    function onClose(ev: React.MouseEvent<Element, MouseEvent>) {
                        ev.stopPropagation();
                        onRemove(selection);
                    }
                    return (
                        <Label key={selection}
                               {...(!option.isDisabled ? { onClose } : { }) }
                               {...(color ? { color } : { }) } >
                            {content}
                        </Label>
                    );
                })}
            </LabelGroup>
        </TextInputGroupMain>
        <TextInputGroupUtilities {...(!inputValue ? { style: { display: 'none' } } : {})}>
          <Button variant="plain" onClick={onClearButtonClick} aria-label={_("Clear input value")}>
            <TimesIcon aria-hidden />
          </Button>
        </TextInputGroupUtilities>
      </TextInputGroup>
    </MenuToggle>
  );

  return (
    <Select
      isOpen={isOpen}
      selected={selected}
      onSelect={_onSelect}
      onOpenChange={(isOpen) => {
        !isOpen && closeMenu();
      }}
      toggle={toggle}
      variant="typeahead"
      ref={innerRef}
      {...props}
    >
      <SelectList>
        {selectOptions.map((option, index) => {
          const { content, value, ...props } = option;

          return (
            <SelectOption key={value} value={value} isFocused={focusedItemIndex === index} {...props}>
              {content}
            </SelectOption>
          );
        })}
      </SelectList>
    </Select>
  );
};

MultiTypeaheadSelectBase.displayName = 'MultiTypeaheadSelectBase';

export const MultiTypeaheadSelect = React.forwardRef((props: MultiTypeaheadSelectProps, ref: React.Ref<any>) => (
  <MultiTypeaheadSelectBase {...props} innerRef={ref} />
));

MultiTypeaheadSelect.displayName = 'MultiTypeaheadSelect';
