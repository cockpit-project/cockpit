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

       https://github.com/patternfly/patternfly-react/blob/v5/packages/react-templates/src/components/Select/CheckboxSelect.tsx

   We don't use it directly from the @patternfly/react-templates node
   module since we want to add features to it, and also to isolate us
   from gratuitous upstream changes.

   Our changes:

   - The selection is controlled from the outside and not maintained
     as internal state. This is how things should work with React.

   - The selected value can be any JavaScript value, not just a string
     or number. Normally, the (stringified) value is used as a React
     key. If your values are not suitable for this because they are
     neither strings nor numbers, you need to provide an explicit key.

     { key: 12, value: { param: "filestate", value: "enabled" }, content: _("Enabled") }

   - The badge is always maintained by this component, in a way that
     avoids layout flicker.

*/

/* eslint-disable */

import React from 'react';
import {
  Badge,
  MenuToggle,
  MenuToggleElement,
  MenuToggleProps,
  Select,
  SelectList,
  SelectOption,
  SelectOptionProps,
  SelectProps
} from '@patternfly/react-core';

export interface CheckboxSelectOption<T> extends Omit<SelectOptionProps, 'content'> {
  /** Content of the select option. */
  content: React.ReactNode;
  /** Value of the select option. */
  value: T;
}

export interface CheckboxSelectProps<T> extends Omit<SelectProps, 'toggle' | 'onSelect'> {
  /** Options of the select. */
  options?: CheckboxSelectOption<T>[];
  /** Currently checked options */
  selected: T[];
  /** Callback triggered when checking or unchecking an option. */
  onSelect: (value: T, checked: boolean) => void;
  /** Callback triggered when the select opens or closes. */
  onToggle?: (nextIsOpen: boolean) => void;
  /** Flag indicating the select should be disabled. */
  isDisabled?: boolean;
  /** Content of the toggle. */
  toggleContent: React.ReactNode;
  /** Width of the toggle. */
  toggleWidth?: string;
  /** Additional props passed to the toggle. */
  toggleProps?: MenuToggleProps;
  /** Is there a badge with the selected options count? */
  noBadge?: boolean,
}

export function CheckboxSelect<T>({
  options,
  selected,
  isDisabled = false,
  onSelect,
  onToggle,
  toggleContent,
  toggleWidth,
  toggleProps,
  noBadge = false,
  ...props
}: CheckboxSelectProps<T>) {
  const [isOpen, setIsOpen] = React.useState(false);

  const checkboxSelectOptions = options?.map((option) => {
    const { content, value, key, ...props } = option;
    const isSelected = selected.includes(value);
    return (
      <SelectOption value={value} key={key !== undefined ? key : `${value}`}
                    hasCheckbox isSelected={isSelected} {...props}>
        {content}
      </SelectOption>
    );
  });

  const onToggleClick = () => {
    onToggle && onToggle(!isOpen);
    setIsOpen(!isOpen);
  };

  const _onSelect = (event: React.MouseEvent<Element, MouseEvent> | undefined, value: T | undefined) => {
    if (value && event) {
      onSelect(value, (event.target as HTMLInputElement).checked);
    }
  };

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      onClick={onToggleClick}
      isExpanded={isOpen}
      isDisabled={isDisabled}
      style={
        {
          width: toggleWidth
        } as React.CSSProperties
      }
      {...toggleProps}
    >
      {toggleContent}
      {!noBadge &&
       <Badge style={{ visibility: selected.length > 0 ? "visible" : "hidden" }} isRead>
         {selected.length}
       </Badge>}
    </MenuToggle>
  );

  return (
    <Select
      isOpen={isOpen}
      selected={selected}
      // @ts-expect-error https://github.com/patternfly/patternfly-react/issues/11361
      onSelect={_onSelect}
      onOpenChange={(isOpen) => {
        onToggle && onToggle(isOpen);
        setIsOpen(isOpen);
      }}
      toggle={toggle}
      role="menu"
      {...props}
    >
      <SelectList>{checkboxSelectOptions}</SelectList>
    </Select>
  );
};
