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

export interface CheckboxSelectOption extends Omit<SelectOptionProps, 'content'> {
  /** Content of the select option. */
  content: React.ReactNode;
  /** Value of the select option. */
  value: string | number;
}

export interface CheckboxSelectProps extends Omit<SelectProps, 'toggle'> {
  /** @hide Forwarded ref */
  innerRef?: React.Ref<any>;
  /** Initial options of the select. */
  initialOptions?: CheckboxSelectOption[];
  /** Callback triggered on selection. */
  onSelect?: (_event: React.MouseEvent<Element, MouseEvent>, value?: string | number) => void;
  /** Callback triggered when the select opens or closes. */
  onToggle?: (nextIsOpen: boolean) => void;
  /** Flag indicating the select should be disabled. */
  isDisabled?: boolean;
  /** Content of the toggle. Defaults to a string with badge count of selected options. */
  toggleContent?: React.ReactNode;
  /** Width of the toggle. */
  toggleWidth?: string;
  /** Additional props passed to the toggle. */
  toggleProps?: MenuToggleProps;
}

const CheckboxSelectBase: React.FunctionComponent<CheckboxSelectProps> = ({
  innerRef,
  initialOptions,
  isDisabled,
  onSelect: passedOnSelect,
  onToggle,
  toggleContent,
  toggleWidth = '200px',
  toggleProps,
  ...props
}: CheckboxSelectProps) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);

  React.useEffect(() => {
    const selectedOptions = initialOptions?.filter((option) => option.selected);
    setSelected(selectedOptions?.map((selectedOption) => String(selectedOption.value)) ?? []);
  }, [initialOptions]);

  const checkboxSelectOptions = initialOptions?.map((option) => {
    const { content, value, ...props } = option;
    const isSelected = selected.includes(`${value}`);
    return (
      <SelectOption value={value} key={value} hasCheckbox isSelected={isSelected} {...props}>
        {content}
      </SelectOption>
    );
  });

  const onToggleClick = () => {
    onToggle && onToggle(!isOpen);
    setIsOpen(!isOpen);
  };

  const onSelect = (event: React.MouseEvent<Element, MouseEvent> | undefined, value: string | number | undefined) => {
    const valueString = `${value}`;
    if (selected.includes(valueString)) {
      setSelected((prevSelected) => prevSelected.filter((item) => item !== valueString));
    } else {
      setSelected((prevSelected) => [...prevSelected, valueString]);
    }
    passedOnSelect && passedOnSelect(event, value);
  };

  const defaultToggleContent = (
    <>
      Filter by status
      {selected.length > 0 && <Badge isRead>{selected.length}</Badge>}
    </>
  );

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
      {toggleContent || defaultToggleContent}
    </MenuToggle>
  );

  return (
    <Select
      isOpen={isOpen}
      selected={selected}
      onSelect={onSelect}
      onOpenChange={(isOpen) => {
        onToggle && onToggle(isOpen);
        setIsOpen(isOpen);
      }}
      toggle={toggle}
      ref={innerRef}
      role="menu"
      {...props}
    >
      <SelectList>{checkboxSelectOptions}</SelectList>
    </Select>
  );
};

export const CheckboxSelect = React.forwardRef((props: CheckboxSelectProps, ref: React.Ref<any>) => (
  <CheckboxSelectBase {...props} innerRef={ref} />
));
