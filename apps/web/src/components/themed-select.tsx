'use client';

import * as Select from '@radix-ui/react-select';
import {CaretDown, CaretUp, Check} from '@phosphor-icons/react';
import type {ReactNode} from 'react';

interface Option {value: string; label: string; disabled?: boolean; icon?: ReactNode}
interface Props {
  label: string;
  value: string;
  options: Option[];
  onValueChange: (value: string) => void;
  variant?: 'composer' | 'settings';
  archive?: boolean;
}
const emptyValue = '__all_sources__';

export function ThemedSelect({label, value, options, onValueChange, variant = 'settings', archive = false}: Props) {
  return <Select.Root value={value || emptyValue} onValueChange={next => onValueChange(next === emptyValue ? '' : next)}>
    <Select.Trigger type="button" className={`select-trigger select-${variant}`} aria-label={label}>
      <Select.Value/>
      <Select.Icon className="select-caret"><CaretDown size={16} aria-hidden="true"/></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className={archive?'select-menu select-menu-archive':'select-menu'} position="popper" sideOffset={8} collisionPadding={12} align="start">
        <Select.ScrollUpButton className="select-scroll"><CaretUp size={16} aria-hidden="true"/></Select.ScrollUpButton>
        <Select.Viewport className="select-options">
          {options.map(option => <Select.Item key={option.value} value={option.value || emptyValue} disabled={option.disabled} className="select-option">
            <Select.ItemText>{option.icon?<span className="select-option-with-icon">{option.icon}{option.label}</span>:option.label}</Select.ItemText>
            <Select.ItemIndicator className="select-check"><Check size={16} weight="bold" aria-hidden="true"/></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="select-scroll"><CaretDown size={16} aria-hidden="true"/></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
